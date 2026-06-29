"""exercising the storage layer end to end against a throwaway temp-file db.

covers init/connect, ingest idempotency + by_type counts, the upsert+read
round-trips for summaries/sleep/metrics, and the tags lifecycle.
"""
from __future__ import annotations

import json

import pytest

from vitaldeck.db import store


# --- fixtures --------------------------------------------------------------


@pytest.fixture()
def conn(tmp_path):
    """a fresh sqlite db in a temp file, schema bootstrapped via connect."""
    db_path = tmp_path / "vd_test.db"
    c = store.connect(db_path)
    try:
        yield c
    finally:
        c.close()


def _rec(t_event_ms: int, rtype: str, sess: int = 1, ctr: int = 0, **data):
    """building one normalized record the way records.normalize would hand it over."""
    return {
        "t_event_ms": t_event_ms,
        "type": rtype,
        "sess": sess,
        "ctr": ctr,
        "tag": None,
        "rt": None,
        "raw_t": None,
        "data": data,
    }


# --- init / connect --------------------------------------------------------


def test_connect_creates_tables(conn):
    # the schema tables should all exist after connect
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()
    names = {r["name"] for r in rows}
    assert {"raw_records", "daily_summaries", "sleep_sessions", "metrics", "tags"} <= names


def test_init_db_is_idempotent(conn):
    # re-running init_db over an existing db must not raise
    store.init_db(conn)
    store.init_db(conn)


# --- ingest idempotency + by_type -----------------------------------------


def test_ingest_counts_and_by_type(conn):
    records = [
        _rec(1000, "heart_rate", bpm=60, asleep=True),
        _rec(2000, "heart_rate", bpm=62, asleep=True),
        _rec(1500, "hrv", rmssd_ms=42.0),
    ]
    result = store.ingest_records(conn, records)
    assert result["ingested"] == 3
    assert result["deduped"] == 0
    assert result["by_type"] == {"heart_rate": 2, "hrv": 1}


def test_ingest_is_idempotent(conn):
    records = [
        _rec(1000, "heart_rate", bpm=60, asleep=True),
        _rec(2000, "hrv", rmssd_ms=40.0),
    ]
    first = store.ingest_records(conn, records)
    assert first["ingested"] == 2
    assert first["deduped"] == 0

    # ingesting the exact same set again -> everything collapses on ux_raw_dedup
    second = store.ingest_records(conn, records)
    assert second["ingested"] == 0
    assert second["deduped"] == 2
    assert second["by_type"] == {}

    # and the table still holds only the original two rows
    count = conn.execute("SELECT COUNT(*) AS c FROM raw_records").fetchone()["c"]
    assert count == 2


def test_ingest_dedup_only_on_key_fields(conn):
    # same (t_event_ms, type, sess) but different data still dedupes
    store.ingest_records(conn, [_rec(1000, "heart_rate", bpm=60)])
    result = store.ingest_records(conn, [_rec(1000, "heart_rate", bpm=99)])
    assert result["ingested"] == 0
    assert result["deduped"] == 1

    # a different sess is a distinct event though
    result2 = store.ingest_records(conn, [_rec(1000, "heart_rate", sess=2, bpm=60)])
    assert result2["ingested"] == 1


def test_get_records_and_data_parsed_back(conn):
    store.ingest_records(
        conn,
        [
            _rec(1000, "heart_rate", bpm=60, asleep=True),
            _rec(3000, "heart_rate", bpm=70, asleep=False),
            _rec(2000, "hrv", rmssd_ms=40.0),
        ],
    )
    hr = store.get_records(conn, "heart_rate")
    assert len(hr) == 2
    # ascending by event time
    assert [r["t_event_ms"] for r in hr] == [1000, 3000]
    # data_json parsed back into a "data" dict
    assert hr[0]["data"] == {"bpm": 60, "asleep": True}
    assert "data_json" not in hr[0]


def test_get_records_time_bounds(conn):
    store.ingest_records(
        conn,
        [
            _rec(1000, "spo2", spo2_pct=97.0),
            _rec(2000, "spo2", spo2_pct=96.0),
            _rec(3000, "spo2", spo2_pct=98.0),
        ],
    )
    mid = store.get_records(conn, "spo2", since_ms=2000, until_ms=2000)
    assert [r["t_event_ms"] for r in mid] == [2000]


def test_get_all_records_and_latest_event_ms(conn):
    assert store.latest_event_ms(conn) is None
    store.ingest_records(
        conn,
        [_rec(1000, "heart_rate", bpm=60), _rec(5000, "hrv", rmssd_ms=40.0)],
    )
    all_recs = store.get_all_records(conn)
    assert len(all_recs) == 2
    assert store.latest_event_ms(conn) == 5000


# --- sync runs -------------------------------------------------------------


def test_sync_run_lifecycle(conn):
    run_id = store.start_sync_run(conn, "capture-001.btsnoop")
    assert run_id >= 1
    store.finish_sync_run(conn, run_id, "ok", ingested=10, deduped=2, notes="done")
    row = conn.execute("SELECT * FROM sync_runs WHERE id = ?", (run_id,)).fetchone()
    assert row["status"] == "ok"
    assert row["records_ingested"] == 10
    assert row["records_deduped"] == 2
    assert row["finished_at"] is not None


# --- daily_summary upsert + read ------------------------------------------


def test_upsert_and_get_daily_summary(conn):
    summary = {
        "date": "2026-06-01",
        "resting_hr": 52.0,
        "hr_min": 48.0,
        "hr_max": 110.0,
        "hr_avg_day": 68.0,
        "hrv_rmssd": 45.0,
        "spo2_avg": 97.0,
        "resp_rate": 14.0,
        "temp_mean_c": 36.4,
        "sleep_min": 430.0,
        "sleep_efficiency": 92.0,
        "sleep_latency_min": 12.0,
        "stage_breakdown_json": {"deep_min": 80, "rem_min": 100, "light_min": 230, "awake_min": 20},
        "steps": 8000,
        "met_high_min": 22.0,
        "source_sync_run_id": 1,
    }
    store.upsert_daily_summary(conn, summary)
    got = store.get_daily_summary(conn, "2026-06-01")
    assert got is not None
    assert got["resting_hr"] == 52.0
    # the json column comes back parsed under the de-suffixed key
    assert got["stage_breakdown"] == {
        "deep_min": 80,
        "rem_min": 100,
        "light_min": 230,
        "awake_min": 20,
    }
    assert "stage_breakdown_json" not in got


def test_upsert_daily_summary_updates_on_conflict(conn):
    store.upsert_daily_summary(conn, {"date": "2026-06-01", "resting_hr": 52.0})
    store.upsert_daily_summary(conn, {"date": "2026-06-01", "resting_hr": 49.0})
    got = store.get_daily_summary(conn, "2026-06-01")
    assert got["resting_hr"] == 49.0
    # still only one row for that date
    count = conn.execute(
        "SELECT COUNT(*) AS c FROM daily_summaries WHERE date = ?", ("2026-06-01",)
    ).fetchone()["c"]
    assert count == 1


def test_get_daily_summaries_recent_ascending(conn):
    for d in ("2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"):
        store.upsert_daily_summary(conn, {"date": d, "hrv_rmssd": 40.0})
    recent = store.get_daily_summaries(conn, days=2)
    assert [r["date"] for r in recent] == ["2026-06-03", "2026-06-04"]
    latest = store.get_latest_daily_summary(conn)
    assert latest["date"] == "2026-06-04"


# --- sleep session upsert + read ------------------------------------------


def test_upsert_and_get_sleep_session(conn):
    session = {
        "date": "2026-06-02",
        "start_ms": 1000,
        "end_ms": 9000,
        "total_min": 420.0,
        "efficiency": 90.0,
        "latency_min": 10.0,
        "deep_min": 80.0,
        "rem_min": 100.0,
        "light_min": 220.0,
        "awake_min": 20.0,
        "stages_json": [{"stage": "light", "duration_s": 600}, {"stage": "deep", "duration_s": 300}],
        "sync_run_id": 1,
    }
    store.upsert_sleep_session(conn, session)
    got = store.get_sleep_sessions(conn, days=30)
    assert len(got) == 1
    assert got[0]["efficiency"] == 90.0
    assert got[0]["stages"][0]["stage"] == "light"
    assert "stages_json" not in got[0]


def test_upsert_sleep_session_conflict_on_bounds(conn):
    base = {"date": "2026-06-02", "start_ms": 1000, "end_ms": 9000, "efficiency": 88.0}
    store.upsert_sleep_session(conn, base)
    store.upsert_sleep_session(conn, {**base, "efficiency": 95.0})
    got = store.get_sleep_sessions(conn, days=30)
    assert len(got) == 1
    assert got[0]["efficiency"] == 95.0


# --- metrics upsert + read -------------------------------------------------


def test_upsert_and_get_metric(conn):
    components = {"hrv": {"value": 45.0, "subscore": 0.7}}
    baselines = {"hrv_rmssd": {"14": 42.0, "30": 41.0}}
    store.upsert_metric(conn, "2026-06-03", 78.5, components, baselines)
    got = store.get_metric(conn, "2026-06-03")
    assert got is not None
    assert got["readiness_custom"] == 78.5
    assert got["components"]["hrv"]["subscore"] == 0.7
    assert got["baselines"]["hrv_rmssd"]["14"] == 42.0


def test_upsert_metric_updates_on_conflict(conn):
    store.upsert_metric(conn, "2026-06-03", 70.0, {}, {})
    store.upsert_metric(conn, "2026-06-03", 82.0, {"sleep": {"subscore": 0.9}}, {})
    got = store.get_metric(conn, "2026-06-03")
    assert got["readiness_custom"] == 82.0
    assert got["components"]["sleep"]["subscore"] == 0.9


def test_get_metrics_recent_ascending(conn):
    for d, score in (("2026-06-01", 70.0), ("2026-06-02", 75.0), ("2026-06-03", 80.0)):
        store.upsert_metric(conn, d, score, {}, {})
    pts = store.get_metrics(conn, days=2)
    assert [p["date"] for p in pts] == ["2026-06-02", "2026-06-03"]


# --- tags ------------------------------------------------------------------


def test_add_list_delete_tags(conn):
    created = store.add_tag(conn, ts_ms=5000, label="late caffeine", note="3pm cold brew")
    assert created["id"] is not None
    assert created["label"] == "late caffeine"
    assert created["created_at"] is not None

    store.add_tag(conn, ts_ms=6000, label="gym")

    tags = store.list_tags(conn)
    assert len(tags) == 2
    # newest first
    assert tags[0]["ts_ms"] == 6000

    deleted = store.delete_tag(conn, created["id"])
    assert deleted is True
    assert len(store.list_tags(conn)) == 1

    # deleting a vanished tag returns False
    assert store.delete_tag(conn, created["id"]) is False


def test_list_tags_window(conn):
    # anchor is the newest tag; a 1-day window keeps only recent ones
    day_ms = 86400 * 1000
    store.add_tag(conn, ts_ms=10 * day_ms, label="old")
    store.add_tag(conn, ts_ms=20 * day_ms, label="recent")
    windowed = store.list_tags(conn, days=1)
    labels = {t["label"] for t in windowed}
    assert labels == {"recent"}


def test_round_trip_json_is_serializable(conn):
    # everything a read returns should survive json.dumps (no Row objects leak)
    store.upsert_metric(conn, "2026-06-03", 80.0, {"hrv": {"subscore": 0.5}}, {})
    got = store.get_metric(conn, "2026-06-03")
    # this would raise if anything non-serializable slipped through
    json.dumps(got)
