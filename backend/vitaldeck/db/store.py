"""the sqlite storage layer — schema bootstrap, idempotent ingest, and reads.

raw_records is the firehose we dedupe into; everything else (daily_summaries,
sleep_sessions, metrics, tags) is a derived projection we upsert. every read
hands back plain json-serializable dicts with the *_json columns parsed back to
objects, so callers never touch sqlite.Row or raw json strings.
"""
from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable
from datetime import datetime, timezone
from typing import Any

from .. import config
from ..records import NO_SESSION, dedup_key

# pointing at the schema next to this module; init_db replays it verbatim.
_SCHEMA_PATH = config.BACKEND_DIR / "vitaldeck" / "db" / "schema.sql"


def _now_iso() -> str:
    """utc iso8601 stamp for sync_runs/tags created_at columns."""
    return datetime.now(timezone.utc).isoformat()


def connect(db_path: Any = config.DB_PATH) -> sqlite3.Connection:
    """opening (and bootstrapping) the db; row_factory=Row so reads are dict-ish.

    runs init_db every time since the schema is all CREATE IF NOT EXISTS — cheap
    and idempotent, and it means a fresh temp-file db just works.
    """
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    init_db(conn)
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    """replaying schema.sql; idempotent because every statement is IF NOT EXISTS."""
    try:
        with open(_SCHEMA_PATH, "r", encoding="utf-8") as fh:
            schema_sql = fh.read()
        conn.executescript(schema_sql)
        conn.commit()
    except (OSError, sqlite3.Error) as exc:
        # surfacing the failure — a missing/broken schema is unrecoverable here
        raise RuntimeError(f"init_db failed reading {_SCHEMA_PATH}: {exc}") from exc


# --- sync runs -------------------------------------------------------------


def start_sync_run(conn: sqlite3.Connection, source_capture: str | None) -> int:
    """opening a sync_runs row in 'running' state; returns its id for finish_."""
    try:
        cur = conn.execute(
            "INSERT INTO sync_runs (started_at, source_capture, status) "
            "VALUES (?, ?, 'running')",
            (_now_iso(), source_capture),
        )
        conn.commit()
        return int(cur.lastrowid)
    except sqlite3.Error as exc:
        # falling back to a sentinel so callers can still ingest without a run id
        print(f"start_sync_run failed: {exc}")
        return -1


def finish_sync_run(
    conn: sqlite3.Connection,
    sync_run_id: int,
    status: str,
    ingested: int,
    deduped: int,
    notes: str | None = None,
) -> None:
    """closing out a sync_runs row with final status + counts."""
    try:
        conn.execute(
            "UPDATE sync_runs SET finished_at = ?, status = ?, "
            "records_ingested = ?, records_deduped = ?, notes = ? WHERE id = ?",
            (_now_iso(), status, ingested, deduped, notes, sync_run_id),
        )
        conn.commit()
    except sqlite3.Error as exc:
        print(f"finish_sync_run failed for run {sync_run_id}: {exc}")


# --- ingest ----------------------------------------------------------------


def ingest_records(
    conn: sqlite3.Connection,
    records: Iterable[dict],
    sync_run_id: int | None = None,
) -> dict:
    """INSERT OR IGNORE each normalized record, counting inserted vs deduped.

    dedupe rides on the ux_raw_dedup unique index (t_event_ms, type, sess); a
    row that collides is silently ignored, so re-running ingest on overlapping
    captures is safe. a record that's actually malformed (missing the NOT NULL
    t_event_ms/type, or carrying non-serializable data) used to vanish into the
    deduped bucket because INSERT OR IGNORE yields rowcount 0 with no error — so
    we validate up front and count those as 'errored', loudly logging each drop.
    deduped is then the honest leftover: attempted - ingested - errored, with a
    by_type breakdown of what actually landed.

    note: this adds an 'errored' key on top of the CONTRACTS §2 shape
    ({ingested, deduped, by_type}); the documented keys are unchanged so callers
    keep working, and the new key surfaces what would otherwise be silent drops.
    """
    ingested = 0
    attempted = 0
    errored = 0
    by_type: dict[str, int] = {}

    for rec in records:
        attempted += 1
        # validating the NOT NULL key fields first; a missing t_event_ms or a
        # non-string type can never insert (INSERT OR IGNORE just swallows it to
        # rowcount 0), so flagging it as errored keeps it out of the deduped count
        t_event_ms = rec.get("t_event_ms")
        rtype = rec.get("type")
        if t_event_ms is None or not isinstance(rtype, str):
            errored += 1
            print(
                f"ingest_records dropped a malformed record "
                f"(t_event_ms={t_event_ms!r}, type={rtype!r})"
            )
            continue
        try:
            # serializing the type-specific fields; missing/odd data -> {} json,
            # but a non-json-serializable data dict raises TypeError -> errored
            data = rec.get("data")
            if not isinstance(data, dict):
                data = {}
            data_json = json.dumps(data)
            cur = conn.execute(
                "INSERT OR IGNORE INTO raw_records "
                "(t_event_ms, type, sess, ctr, tag, data_json, sync_run_id) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    t_event_ms,
                    rtype,
                    rec.get("sess", NO_SESSION),
                    rec.get("ctr", -1),
                    _tag_to_text(rec.get("tag")),
                    data_json,
                    sync_run_id,
                ),
            )
            if cur.rowcount and cur.rowcount > 0:
                # rowcount 1 means a fresh insert; 0 means the unique index ignored it
                ingested += 1
                by_type[rtype] = by_type.get(rtype, 0) + 1
        except (sqlite3.Error, TypeError, ValueError) as exc:
            # a real failure (unserializable data or a sqlite error) — counting it
            # as errored and logging loudly rather than burying it in deduped
            errored += 1
            print(f"ingest_records errored on a record: {exc}")
            continue

    try:
        conn.commit()
    except sqlite3.Error as exc:
        print(f"ingest_records commit failed: {exc}")

    deduped = attempted - ingested - errored
    return {
        "ingested": ingested,
        "deduped": deduped,
        "by_type": by_type,
        "errored": errored,
    }


def _tag_to_text(tag: Any) -> str | None:
    """raw_records.tag is TEXT; stringifying non-text tags so they round-trip."""
    if tag is None or isinstance(tag, str):
        return tag
    try:
        return json.dumps(tag)
    except (TypeError, ValueError):
        return str(tag)


# --- upserts ---------------------------------------------------------------

# the daily_summaries columns we accept on upsert (date is the conflict key)
_SUMMARY_COLS = (
    "resting_hr",
    "hr_min",
    "hr_max",
    "hr_avg_day",
    "hrv_rmssd",
    "spo2_avg",
    "resp_rate",
    "temp_mean_c",
    "sleep_min",
    "sleep_efficiency",
    "sleep_latency_min",
    "stage_breakdown_json",
    "steps",
    "met_high_min",
    "source_sync_run_id",
)


def upsert_daily_summary(conn: sqlite3.Connection, summary: dict) -> None:
    """UPSERT one daily_summaries row keyed on date.

    stage_breakdown_json is accepted as either a dict (we json.dumps it) or an
    already-serialized string, so summarize can hand us whichever it has.
    """
    try:
        date = summary.get("date")
        if not date:
            print("upsert_daily_summary skipped: missing date")
            return

        values = {col: summary.get(col) for col in _SUMMARY_COLS}
        sb = values.get("stage_breakdown_json")
        if isinstance(sb, (dict, list)):
            values["stage_breakdown_json"] = json.dumps(sb)

        cols = ("date",) + _SUMMARY_COLS
        placeholders = ", ".join("?" for _ in cols)
        updates = ", ".join(f"{c}=excluded.{c}" for c in _SUMMARY_COLS)
        row = (date,) + tuple(values[c] for c in _SUMMARY_COLS)
        conn.execute(
            f"INSERT INTO daily_summaries ({', '.join(cols)}) "
            f"VALUES ({placeholders}) "
            f"ON CONFLICT(date) DO UPDATE SET {updates}",
            row,
        )
        conn.commit()
    except (sqlite3.Error, TypeError, ValueError) as exc:
        print(f"upsert_daily_summary failed: {exc}")


_SLEEP_COLS = (
    "date",
    "start_ms",
    "end_ms",
    "total_min",
    "efficiency",
    "latency_min",
    "deep_min",
    "rem_min",
    "light_min",
    "awake_min",
    "stages_json",
    "sync_run_id",
)


def upsert_sleep_session(conn: sqlite3.Connection, session: dict) -> None:
    """UPSERT one sleep_sessions row keyed on (start_ms, end_ms)."""
    try:
        if session.get("start_ms") is None or session.get("end_ms") is None:
            print("upsert_sleep_session skipped: missing start_ms/end_ms")
            return

        values = {col: session.get(col) for col in _SLEEP_COLS}
        sj = values.get("stages_json")
        if isinstance(sj, (dict, list)):
            values["stages_json"] = json.dumps(sj)

        placeholders = ", ".join("?" for _ in _SLEEP_COLS)
        # not overwriting the conflict keys themselves on update
        update_cols = [c for c in _SLEEP_COLS if c not in ("start_ms", "end_ms")]
        updates = ", ".join(f"{c}=excluded.{c}" for c in update_cols)
        row = tuple(values[c] for c in _SLEEP_COLS)
        conn.execute(
            f"INSERT INTO sleep_sessions ({', '.join(_SLEEP_COLS)}) "
            f"VALUES ({placeholders}) "
            f"ON CONFLICT(start_ms, end_ms) DO UPDATE SET {updates}",
            row,
        )
        conn.commit()
    except (sqlite3.Error, TypeError, ValueError) as exc:
        print(f"upsert_sleep_session failed: {exc}")


def upsert_metric(
    conn: sqlite3.Connection,
    date: str,
    readiness_custom: float,
    components: dict,
    baselines: dict,
) -> None:
    """UPSERT one metrics row keyed on date; components/baselines stored as json."""
    try:
        conn.execute(
            "INSERT INTO metrics (date, readiness_custom, components_json, baselines_json) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT(date) DO UPDATE SET "
            "readiness_custom=excluded.readiness_custom, "
            "components_json=excluded.components_json, "
            "baselines_json=excluded.baselines_json",
            (
                date,
                readiness_custom,
                json.dumps(components if components is not None else {}),
                json.dumps(baselines if baselines is not None else {}),
            ),
        )
        conn.commit()
    except (sqlite3.Error, TypeError, ValueError) as exc:
        print(f"upsert_metric failed for {date}: {exc}")


# --- reads -----------------------------------------------------------------

# columns we json.loads back into objects when handing a row to a caller
_JSON_COLS = {
    "data_json",
    "stage_breakdown_json",
    "stages_json",
    "components_json",
    "baselines_json",
}


def _row_to_dict(row: sqlite3.Row | None) -> dict | None:
    """turning a Row into a plain dict, parsing the *_json columns back to objects.

    a column named foo_json comes back as foo -> parsed object; everything else
    passes through untouched. None/empty json columns stay None.
    """
    if row is None:
        return None
    out: dict[str, Any] = {}
    for key in row.keys():
        value = row[key]
        if key in _JSON_COLS:
            parsed = None
            if value:
                try:
                    parsed = json.loads(value)
                except (ValueError, TypeError):
                    parsed = None
            # exposing data_json as "data", foo_json as "foo"
            out[key[:-5]] = parsed
        else:
            out[key] = value
    return out


def get_daily_summary(conn: sqlite3.Connection, date: str) -> dict | None:
    try:
        row = conn.execute(
            "SELECT * FROM daily_summaries WHERE date = ?", (date,)
        ).fetchone()
        return _row_to_dict(row)
    except sqlite3.Error as exc:
        print(f"get_daily_summary failed for {date}: {exc}")
        return None


def get_latest_daily_summary(conn: sqlite3.Connection) -> dict | None:
    try:
        row = conn.execute(
            "SELECT * FROM daily_summaries ORDER BY date DESC LIMIT 1"
        ).fetchone()
        return _row_to_dict(row)
    except sqlite3.Error as exc:
        print(f"get_latest_daily_summary failed: {exc}")
        return None


def get_daily_summaries(conn: sqlite3.Connection, days: int) -> list[dict]:
    """most recent N summaries, returned ascending by date for charting."""
    try:
        rows = conn.execute(
            "SELECT * FROM (SELECT * FROM daily_summaries ORDER BY date DESC LIMIT ?) "
            "ORDER BY date ASC",
            (days,),
        ).fetchall()
        return [d for d in (_row_to_dict(r) for r in rows) if d is not None]
    except sqlite3.Error as exc:
        print(f"get_daily_summaries failed: {exc}")
        return []


def get_records(
    conn: sqlite3.Connection,
    type: str,
    since_ms: int | None = None,
    until_ms: int | None = None,
) -> list[dict]:
    """pulling raw_records of one type, optionally bounded by event time."""
    try:
        sql = "SELECT * FROM raw_records WHERE type = ?"
        params: list[Any] = [type]
        if since_ms is not None:
            sql += " AND t_event_ms >= ?"
            params.append(since_ms)
        if until_ms is not None:
            sql += " AND t_event_ms <= ?"
            params.append(until_ms)
        sql += " ORDER BY t_event_ms ASC"
        rows = conn.execute(sql, params).fetchall()
        return [d for d in (_row_to_dict(r) for r in rows) if d is not None]
    except sqlite3.Error as exc:
        print(f"get_records failed for type {type}: {exc}")
        return []


def get_all_records(conn: sqlite3.Connection) -> list[dict]:
    """the whole firehose, ascending by time — for summarize.rebuild_all."""
    try:
        rows = conn.execute(
            "SELECT * FROM raw_records ORDER BY t_event_ms ASC"
        ).fetchall()
        return [d for d in (_row_to_dict(r) for r in rows) if d is not None]
    except sqlite3.Error as exc:
        print(f"get_all_records failed: {exc}")
        return []


def get_sleep_sessions(conn: sqlite3.Connection, days: int) -> list[dict]:
    """most recent N sleep sessions by date, ascending for display."""
    try:
        rows = conn.execute(
            "SELECT * FROM (SELECT * FROM sleep_sessions ORDER BY date DESC, end_ms DESC "
            "LIMIT ?) ORDER BY date ASC, end_ms ASC",
            (days,),
        ).fetchall()
        return [d for d in (_row_to_dict(r) for r in rows) if d is not None]
    except sqlite3.Error as exc:
        print(f"get_sleep_sessions failed: {exc}")
        return []


def get_metric(conn: sqlite3.Connection, date: str) -> dict | None:
    try:
        row = conn.execute("SELECT * FROM metrics WHERE date = ?", (date,)).fetchone()
        return _row_to_dict(row)
    except sqlite3.Error as exc:
        print(f"get_metric failed for {date}: {exc}")
        return None


def get_metrics(conn: sqlite3.Connection, days: int) -> list[dict]:
    """most recent N metrics rows, ascending by date."""
    try:
        rows = conn.execute(
            "SELECT * FROM (SELECT * FROM metrics ORDER BY date DESC LIMIT ?) "
            "ORDER BY date ASC",
            (days,),
        ).fetchall()
        return [d for d in (_row_to_dict(r) for r in rows) if d is not None]
    except sqlite3.Error as exc:
        print(f"get_metrics failed: {exc}")
        return []


def latest_event_ms(conn: sqlite3.Connection) -> int | None:
    """max(t_event_ms) — drives the app's 'data as of' line."""
    try:
        row = conn.execute("SELECT MAX(t_event_ms) AS m FROM raw_records").fetchone()
        if row is None or row["m"] is None:
            return None
        return int(row["m"])
    except (sqlite3.Error, TypeError, ValueError) as exc:
        print(f"latest_event_ms failed: {exc}")
        return None


# --- tags ------------------------------------------------------------------


def add_tag(
    conn: sqlite3.Connection,
    ts_ms: int,
    label: str,
    note: str | None = None,
) -> dict:
    """inserting an event tag; returns the created row as a plain dict."""
    try:
        created_at = _now_iso()
        cur = conn.execute(
            "INSERT INTO tags (ts_ms, label, note, created_at) VALUES (?, ?, ?, ?)",
            (ts_ms, label, note, created_at),
        )
        conn.commit()
        tag_id = int(cur.lastrowid)
        return {
            "id": tag_id,
            "ts_ms": ts_ms,
            "label": label,
            "note": note,
            "created_at": created_at,
        }
    except sqlite3.Error as exc:
        print(f"add_tag failed: {exc}")
        # returning a best-effort dict without an id so callers don't crash
        return {
            "id": None,
            "ts_ms": ts_ms,
            "label": label,
            "note": note,
            "created_at": None,
        }


def list_tags(conn: sqlite3.Connection, days: int | None = None) -> list[dict]:
    """all tags (newest first); when days is set, only those within that window.

    the window is measured back from the newest tag's ts_ms (data is batch-loaded
    and may lag wall-clock, so anchoring to now() would hide everything).
    """
    try:
        if days is None:
            rows = conn.execute(
                "SELECT * FROM tags ORDER BY ts_ms DESC"
            ).fetchall()
        else:
            anchor_row = conn.execute(
                "SELECT MAX(ts_ms) AS m FROM tags"
            ).fetchone()
            if anchor_row is None or anchor_row["m"] is None:
                return []
            cutoff = int(anchor_row["m"]) - days * 86400 * 1000
            rows = conn.execute(
                "SELECT * FROM tags WHERE ts_ms >= ? ORDER BY ts_ms DESC",
                (cutoff,),
            ).fetchall()
        return [d for d in (_row_to_dict(r) for r in rows) if d is not None]
    except (sqlite3.Error, TypeError, ValueError) as exc:
        print(f"list_tags failed: {exc}")
        return []


def delete_tag(conn: sqlite3.Connection, tag_id: int) -> bool:
    """removing a tag by id; True if a row actually went away."""
    try:
        cur = conn.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
        conn.commit()
        return bool(cur.rowcount and cur.rowcount > 0)
    except sqlite3.Error as exc:
        print(f"delete_tag failed for {tag_id}: {exc}")
        return False
