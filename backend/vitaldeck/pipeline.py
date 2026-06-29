"""shared post-ingest pipeline: rebuild the derived tables from raw_records and
recompute readiness. lives OUTSIDE the api module so the CLIs (tools.ingest_zip,
tools.validate) and the scheduler can reuse it without importing FastAPI."""
from __future__ import annotations

import sqlite3

from vitaldeck import summarize
from vitaldeck.db import store
from vitaldeck.metrics import baselines as baselines_mod
from vitaldeck.metrics import readiness as readiness_mod


def score_only(conn: sqlite3.Connection) -> None:
    """recompute readiness for the recent days off whatever daily_summaries are
    currently stored — WITHOUT rebuilding them (the oura path upserts its own).

    compute_baselines over the slice up to and including each day keeps the
    baseline causal (no peeking at future days)."""
    try:
        summaries = store.get_daily_summaries(conn, 60)
    except Exception as exc:
        print(f"[pipeline] get_daily_summaries failed: {exc}")
        return

    for i, today in enumerate(summaries):
        try:
            window = summaries[: i + 1]
            bl = baselines_mod.compute_baselines(window)
            scored = readiness_mod.compute_readiness(today, bl)
            store.upsert_metric(
                conn,
                today.get("date"),
                scored.get("score"),
                scored.get("components", {}),
                bl,
            )
        except Exception as exc:
            print(f"[pipeline] readiness recompute for {today.get('date')} failed: {exc}")
            continue


def recompute(conn: sqlite3.Connection) -> None:
    """raw-based paths (synthetic / live snoop / manual zip): rebuild
    daily_summaries + sleep_sessions from raw_records, then score."""
    try:
        summarize.rebuild_all(conn)
    except Exception as exc:
        print(f"[pipeline] rebuild_all failed: {exc}")
        return
    score_only(conn)
