"""mapping test for the oura api ingest — build() is pure, so we feed a sample
v2 payload and assert it maps onto our daily_summary + sleep_session shapes
(no network)."""
from __future__ import annotations

from vitaldeck.ingest import oura_api

SAMPLE = {
    "sleep": [
        {
            "day": "2026-06-20",
            "type": "long_sleep",
            "bedtime_start": "2026-06-19T23:30:00-05:00",
            "bedtime_end": "2026-06-20T07:10:00-05:00",
            "total_sleep_duration": 25800,  # 430 min
            "awake_time": 1200,             # 20 min
            "light_sleep_duration": 15000,
            "deep_sleep_duration": 4800,    # 80 min
            "rem_sleep_duration": 6000,     # 100 min
            "efficiency": 92,
            "latency": 600,                 # 10 min
            "lowest_heart_rate": 50,
            "average_heart_rate": 58,
            "average_hrv": 56,
            "average_breath": 14.5,
        },
        {
            # a short nap the same day must NOT win over the long_sleep
            "day": "2026-06-20",
            "type": "late_nap",
            "bedtime_start": "2026-06-20T14:00:00-05:00",
            "bedtime_end": "2026-06-20T14:40:00-05:00",
            "total_sleep_duration": 2400,
        },
    ],
    "daily_readiness": [{"day": "2026-06-20", "score": 70, "temperature_deviation": 0.3}],
    "daily_spo2": [{"day": "2026-06-20", "spo2_percentage": {"average": 97.2}}],
    "daily_activity": [{"day": "2026-06-20", "steps": 8200, "high_activity_time": 1800}],
}


def test_build_maps_daily_and_sleep():
    out = oura_api.build(SAMPLE)
    assert len(out["daily"]) == 1
    assert len(out["sleep"]) == 1

    d = out["daily"][0]
    assert d["date"] == "2026-06-20"
    assert d["resting_hr"] == 50
    assert d["hrv_rmssd"] == 56
    assert d["sleep_min"] == 430.0
    assert d["sleep_efficiency"] == 92
    assert d["sleep_latency_min"] == 10.0
    assert d["temp_mean_c"] == 36.8  # 36.5 nominal + 0.3 deviation
    assert d["spo2_avg"] == 97.2
    assert d["resp_rate"] == 14.5
    assert d["steps"] == 8200
    assert d["met_high_min"] == 30.0

    s = out["sleep"][0]
    assert s["date"] == "2026-06-20"
    assert s["deep_min"] == 80.0
    assert s["rem_min"] == 100.0
    assert s["awake_min"] == 20.0
    assert s["total_min"] == 430.0
    assert s["start_ms"] < s["end_ms"]


def test_build_picks_long_sleep_over_nap():
    # the 430-min long_sleep must be the chosen night, not the 40-min nap
    assert oura_api.build(SAMPLE)["daily"][0]["sleep_min"] == 430.0


def test_build_tolerates_missing_optional_endpoints():
    out = oura_api.build({"sleep": SAMPLE["sleep"]})
    d = out["daily"][0]
    assert d["spo2_avg"] is None
    assert d["temp_mean_c"] is None  # no readiness -> no temp deviation
    assert d["steps"] is None
    assert d["sleep_min"] == 430.0
