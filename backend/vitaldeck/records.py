"""record-envelope normalization + the consumer filters open_ring's PROTOCOL.md
§9.3 tells every consumer to apply.

everything decoded from a snoop capture flows through here first, so the rest of
the backend can assume clean, analytics-ready records keyed on t_event_ms.
"""
from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from typing import Any, Optional

# open_ring packs ring_time as (sess<<16)|ctr into `rt`; values at/above 2^31 are
# the misparses §9.3 says to drop.
RT_MISPARSE_THRESHOLD = 2 ** 31

# sentinels we substitute when the envelope omits sess/ctr, so the dedupe unique
# index treats "no session" as one comparable value instead of SQL NULLs (which
# compare distinct and would silently defeat dedupe).
NO_SESSION = -1
NO_COUNTER = -1


def parse_jsonl(lines: Iterable[str]) -> Iterator[dict[str, Any]]:
    """yielding one decoded dict per non-blank line, skipping junk.

    replay emits one Record per line; we stay defensive because a truncated
    capture can leave a half-written final line.
    """
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except (ValueError, TypeError):
            # skipping unparseable lines instead of blowing up the whole ingest
            continue
        if isinstance(obj, dict):
            yield obj


def normalize(raw: dict[str, Any]) -> Optional[dict[str, Any]]:
    """coercing one raw envelope into our internal record, or None to drop it.

    applies the consumer filters: needs a usable t_event_ms + type, and drops
    rt-misparse records. uses t_event_ms (when the ring generated the event),
    never t (when the phone received it) — catch-up records arrive late.
    """
    if not isinstance(raw, dict):
        return None

    rtype = raw.get("type")
    if not rtype or not isinstance(rtype, str):
        return None

    # preferring t_event_ms; falling back to t only if event time is absent
    t_event = raw.get("t_event_ms")
    if t_event is None:
        t_event = raw.get("t")
    try:
        t_event_ms = int(t_event)
    except (TypeError, ValueError):
        return None

    # dropping the ring_time misparses §9.3 calls out
    rt = raw.get("rt")
    if rt is not None:
        try:
            if int(rt) >= RT_MISPARSE_THRESHOLD:
                return None
        except (TypeError, ValueError):
            rt = None

    sess = _coerce_int(raw.get("sess"), NO_SESSION)
    ctr = _coerce_int(raw.get("ctr"), NO_COUNTER)

    data = raw.get("data")
    if not isinstance(data, dict):
        data = {}

    return {
        "t_event_ms": t_event_ms,
        "type": rtype,
        "sess": sess,
        "ctr": ctr,
        "tag": raw.get("tag"),
        "rt": rt,
        "raw_t": raw.get("t"),
        "data": data,
    }


def _coerce_int(value: Any, default: int) -> int:
    try:
        return int(value) if value is not None else default
    except (TypeError, ValueError):
        return default


def dedup_key(rec: dict[str, Any]) -> tuple:
    """the idempotency key ingest dedupes on — matches the schema unique index
    ux_raw_dedup (t_event_ms, type, sess)."""
    return (rec["t_event_ms"], rec["type"], rec.get("sess", NO_SESSION))


def iter_normalized(raw_records: Iterable[dict[str, Any]]) -> Iterator[dict[str, Any]]:
    """streaming raw envelopes through normalize, dropping the filtered ones."""
    for raw in raw_records:
        rec = normalize(raw)
        if rec is not None:
            yield rec
