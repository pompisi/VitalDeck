"""seed.py — the end-to-end proof, runnable as `python -m tools.seed`.

it drives the whole backend with synthetic data:
  synth.generate -> store.ingest_records -> summarize.rebuild_all ->
  compute baselines + readiness per recent day -> store.upsert_metric
then prints a small table of the last 7 days' readiness so a human can eyeball
that the injected bad nights actually dent the score.

run from `backend/` so the `vitaldeck` and `tools` packages import cleanly:
    python -m tools.seed --days 30 --db /tmp/vd.db
"""
from __future__ import annotations

import argparse
import os
import sys

from tools import synth


def _print_table(rows: list[tuple[str, object, object, object, object]]) -> None:
    """rendering the last few days as a tiny fixed-width table — no deps."""
    header = ("date", "readiness", "hrv", "rest_hr", "temp_c")
    widths = (12, 10, 8, 8, 9)

    def fmt_row(cells: tuple) -> str:
        out = []
        for cell, w in zip(cells, widths):
            out.append(str(cell).ljust(w))
        return "  ".join(out)

    print(fmt_row(header))
    print(fmt_row(tuple("-" * w for w in widths)))
    for r in rows:
        print(fmt_row(r))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="seed VitalDeck with synthetic data")
    parser.add_argument("--days", type=int, default=30, help="how many days to generate")
    parser.add_argument("--db", type=str, default=None, help="sqlite path (defaults to config.DB_PATH)")
    parser.add_argument("--seed", type=int, default=42, help="rng seed for reproducibility")
    args = parser.parse_args(argv)

    # pointing the db at --db before importing the store-touching modules so
    # config.DB_PATH picks it up. config reads VITALDECK_DB at import time.
    if args.db:
        os.environ["VITALDECK_DB"] = args.db

    # importing lazily (after the env tweak) and defensively — these belong to
    # other agents and may not all be present while the spine is mid-build.
    try:
        from vitaldeck import config
        from vitaldeck.db import store
        from vitaldeck import summarize
        from vitaldeck.metrics import baselines as baselines_mod
        from vitaldeck.metrics import readiness as readiness_mod
    except Exception as exc:  # pragma: no cover — depends on sibling modules
        print(f"seed: could not import backend modules ({exc}). is the spine built?")
        return 1

    db_path = args.db or str(getattr(config, "DB_PATH", "vitaldeck.db"))
    print(f"seed: generating {args.days} day(s) of synthetic data -> {db_path}")

    # 1) generate the synthetic firehose
    records = synth.generate(days=args.days, seed=args.seed)
    print(f"seed: generated {len(records)} raw records")

    # 2) ingest into the raw store (idempotent / deduped)
    try:
        conn = store.connect(db_path)
    except Exception as exc:
        print(f"seed: failed opening db: {exc}")
        return 1

    try:
        result = store.ingest_records(conn, records)
        print(
            f"seed: ingested {result.get('ingested', 0)} "
            f"(deduped {result.get('deduped', 0)})"
        )
    except Exception as exc:
        print(f"seed: ingest failed: {exc}")
        return 1

    # 3) rebuild daily summaries + sleep sessions from the raw records
    try:
        rebuilt = summarize.rebuild_all(conn)
        print(
            f"seed: rebuilt {rebuilt.get('days', 0)} daily summaries, "
            f"{rebuilt.get('sleep_sessions', 0)} sleep sessions"
        )
    except Exception as exc:
        print(f"seed: rebuild failed: {exc}")
        return 1

    # 4) recompute baselines + readiness per recent day, upserting metrics.
    #    pulling enough history that the 30-day baseline window is well-fed.
    try:
        summaries = store.get_daily_summaries(conn, max(args.days, 60))
    except Exception as exc:
        print(f"seed: could not read summaries: {exc}")
        summaries = []

    computed = 0
    for idx, today in enumerate(summaries):
        try:
            # baselines see everything up to and including `today` (ascending),
            # so the window means reflect the personal history before scoring.
            history = summaries[: idx + 1]
            bl = baselines_mod.compute_baselines(history)
            rd = readiness_mod.compute_readiness(today, bl)
            store.upsert_metric(
                conn,
                today.get("date"),
                rd.get("score", 0.0),
                rd.get("components", {}),
                bl,
            )
            computed += 1
        except Exception as exc:  # keep going; one bad day shouldn't abort the seed
            print(f"seed: metric compute failed for {today.get('date')}: {exc}")
    print(f"seed: computed readiness for {computed} day(s)")

    # 5) print the last 7 days' readiness so the bad-night dips are visible
    try:
        metrics = store.get_metrics(conn, 7)
    except Exception as exc:
        print(f"seed: could not read metrics back: {exc}")
        metrics = []

    rows: list[tuple] = []
    for m in metrics:
        date = m.get("date")
        readiness = m.get("readiness_custom")
        comps = m.get("components") or {}
        hrv = comps.get("hrv", {}).get("value") if isinstance(comps, dict) else None
        rhr = comps.get("resting_hr", {}).get("value") if isinstance(comps, dict) else None
        temp = comps.get("temp", {}).get("value") if isinstance(comps, dict) else None
        rows.append((date, readiness, hrv, rhr, temp))

    if rows:
        print()
        _print_table(rows)
    else:
        print("seed: no metrics to show (did summaries build?)")

    try:
        conn.close()
    except Exception:
        pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
