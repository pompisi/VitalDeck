"""decode + ingest a manually-provided Android bug-report zip (or a raw btsnoop
file) — the no-adb, personal-phone snoop-log path. reuses the exact pipeline the
api uses, just fed from a file you dropped onto the Pi (e.g. via Tailscale
Taildrop) instead of pulled over adb.

  python -m tools.ingest_zip <bugreport.zip | btsnoop_hci.log> [--db PATH]

prints a record-type histogram first — the smoke test: did open_ring's keyless
`replay` actually decode the ring's BLE? — then ingests + recomputes.
"""
from __future__ import annotations

import argparse
import collections
import sys
from pathlib import Path

from vitaldeck import config, pipeline
from vitaldeck.db import store
from vitaldeck.ingest import decode as decode_mod
from vitaldeck.ingest import pull_snoop


def _resolve_btsnoop(path: Path) -> Path:
    """a .zip is a bugreport -> extract its btsnoop; anything else is assumed to
    be a raw btsnoop capture already."""
    if path.suffix.lower() == ".zip":
        print(f"extracting btsnoop from bugreport {path.name} ...")
        return pull_snoop.extract_btsnoop(path)
    return path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="decode + ingest a bug-report zip / btsnoop capture")
    ap.add_argument("capture", help="path to a bugreport .zip or a raw btsnoop_hci.log")
    ap.add_argument("--db", help="sqlite db path (defaults to config.DB_PATH)")
    args = ap.parse_args(argv)

    cap = Path(args.capture)
    if not cap.exists():
        print(f"capture not found: {cap}", file=sys.stderr)
        return 2

    try:
        btsnoop = _resolve_btsnoop(cap)
    except pull_snoop.PullError as exc:
        print(f"extraction failed: {exc}", file=sys.stderr)
        return 1

    print(f"decoding {btsnoop} via open_ring replay ...")
    try:
        records = list(decode_mod.decode_capture(btsnoop))
    except decode_mod.DecodeError as exc:
        print(f"decode failed: {exc}", file=sys.stderr)
        print(
            "smoke test FAILED — replay errored. check that the snoop actually captured the "
            "ring's traffic and that open_ring is vendored at backend/vendor/open_ring.",
            file=sys.stderr,
        )
        return 1

    # the smoke test: what did replay decode?
    hist = collections.Counter(r.get("type") for r in records)
    print(f"\n=== decoded {len(records)} records ===")
    for rtype, n in hist.most_common():
        print(f"  {str(rtype):<18} {n}")
    if not records:
        print(
            "\nsmoke test FAILED — zero records decoded. the snoop probably didn't contain the "
            "ring's GATT traffic (sync the Oura app with the ring while snoop logging is on), "
            "or this firmware needs a different decode path.",
            file=sys.stderr,
        )
        return 1

    db_path = args.db or config.DB_PATH
    print(f"\ningesting into {db_path} ...")
    conn = store.connect(db_path)
    try:
        run_id = None
        try:
            run_id = store.start_sync_run(conn, f"manual-zip:{cap.name}")
        except Exception as exc:
            print(f"start_sync_run failed: {exc}")
        result = store.ingest_records(conn, records, run_id)
        if run_id is not None:
            try:
                store.finish_sync_run(
                    conn, run_id, "ok",
                    int(result.get("ingested", 0)), int(result.get("deduped", 0)),
                )
            except Exception as exc:
                print(f"finish_sync_run failed: {exc}")
        pipeline.recompute(conn)
    finally:
        conn.close()

    print(
        f"ingested {result.get('ingested')} "
        f"(deduped {result.get('deduped')}, errored {result.get('errored', 0)})"
    )
    print("done — reload the app to see the snoop-sourced day(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
