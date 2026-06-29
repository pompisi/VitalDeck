"""tests for the shared pipeline + the validate diff (the pure, no-network parts)."""
from __future__ import annotations

import json

from tools import synth, validate
from vitaldeck import pipeline
from vitaldeck.db import store


def test_recompute_scores_after_ingest(tmp_path):
    db = tmp_path / "p.db"
    conn = store.connect(db)
    try:
        store.ingest_records(conn, synth.generate(days=10, seed=7))
        pipeline.recompute(conn)
        metrics = store.get_metrics(conn, 10)
        assert metrics, "recompute should produce metric rows"
        assert all(m.get("readiness_custom") is not None for m in metrics)
    finally:
        conn.close()


def test_diff_rows_compares_scalars_and_stages():
    snoop = {
        "2026-06-20": {
            "date": "2026-06-20", "hrv_rmssd": 77.0, "resting_hr": 55.0,
            "spo2_avg": 96.0, "resp_rate": 14.0, "sleep_min": 430.0, "sleep_efficiency": 90.0,
            "stage_breakdown_json": json.dumps(
                {"deep_min": 80.0, "rem_min": 100.0, "light_min": 230.0, "awake_min": 20.0}
            ),
        }
    }
    api = {
        "2026-06-20": {
            "date": "2026-06-20", "hrv_rmssd": 78.0, "resting_hr": 55.0,
            "spo2_avg": 95.0, "resp_rate": 14.5, "sleep_min": 428.0, "sleep_efficiency": 89.0,
            "stage_breakdown_json": json.dumps(
                {"deep_min": 82.0, "rem_min": 98.0, "light_min": 228.0, "awake_min": 22.0}
            ),
        }
    }
    by_field = {r["field"]: r for r in validate.diff_rows(snoop, api)}
    assert by_field["hrv_rmssd"]["delta"] == -1.0
    assert by_field["resting_hr"]["delta"] == 0.0
    assert by_field["deep_min"]["delta"] == -2.0
    assert {"deep_min", "rem_min", "light_min", "awake_min"} <= set(by_field)


def test_diff_rows_skips_missing_values():
    # hrv: api None -> skip; resting_hr: snoop missing -> skip; no stages -> nothing
    snoop = {"2026-06-20": {"date": "2026-06-20", "hrv_rmssd": 70.0}}
    api = {"2026-06-20": {"date": "2026-06-20", "hrv_rmssd": None, "resting_hr": 55.0}}
    assert validate.diff_rows(snoop, api) == []
