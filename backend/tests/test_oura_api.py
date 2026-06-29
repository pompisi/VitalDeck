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


# --- stage-staging fallback (the "DEEP/REM/LIGHT read 0" fix) ---------------

# a night whose explicit *_duration fields are missing but that carries the
# 5-min hypnogram: 3xdeep, 3xlight, 3xrem, 1xawake -> 15/15/15/5 minutes.
HYPNO_NIGHT = {
    "day": "2026-06-21",
    "type": "long_sleep",
    "bedtime_start": "2026-06-20T23:30:00-05:00",
    "bedtime_end": "2026-06-21T07:10:00-05:00",
    "total_sleep_duration": 25800,
    "efficiency": 90,
    "latency": 600,
    # no deep_/rem_/light_sleep_duration, no awake_time
    "sleep_phase_5_min": "1112223334",
}


def test_hypnogram_minutes_helper():
    m = oura_api._hypnogram_minutes("1112223334")
    assert m == {"deep_min": 15.0, "light_min": 15.0, "rem_min": 15.0, "awake_min": 5.0}
    assert oura_api._hypnogram_minutes(None) is None
    assert oura_api._hypnogram_minutes("") is None
    assert oura_api._hypnogram_minutes("0000") is None  # no recognized stages


def test_build_derives_stages_from_hypnogram_when_durations_missing():
    out = oura_api.build({"sleep": [HYPNO_NIGHT]})
    d = out["daily"][0]
    stages = json.loads(d["stage_breakdown_json"])
    assert stages == {
        "deep_min": 15.0,
        "rem_min": 15.0,
        "light_min": 15.0,
        "awake_min": 5.0,
    }
    s = out["sleep"][0]
    assert (s["deep_min"], s["rem_min"], s["light_min"], s["awake_min"]) == (
        15.0,
        15.0,
        15.0,
        5.0,
    )
    # stages_json gets run-length expanded from the hypnogram (was always None)
    assert s["stages_json"] == [
        {"stage": "deep", "duration_s": 900},
        {"stage": "light", "duration_s": 900},
        {"stage": "rem", "duration_s": 900},
        {"stage": "awake", "duration_s": 300},
    ]


def test_explicit_durations_win_over_hypnogram():
    # when both are present, trust oura's computed durations, not the hypnogram
    night = dict(HYPNO_NIGHT)
    night["deep_sleep_duration"] = 4800   # 80 min
    night["rem_sleep_duration"] = 6000    # 100 min
    night["light_sleep_duration"] = 15000  # 250 min
    s = oura_api.build({"sleep": [night]})["sleep"][0]
    assert s["deep_min"] == 80.0
    assert s["rem_min"] == 100.0
    assert s["light_min"] == 250.0


def test_picker_prefers_staged_record_over_unstaged():
    day = "2026-06-22"
    unstaged_long = {
        "day": day,
        "type": "long_sleep",
        "bedtime_start": "2026-06-21T23:00:00-05:00",
        "bedtime_end": "2026-06-22T07:30:00-05:00",
        "total_sleep_duration": 30000,  # longer, but no staging at all
    }
    staged = {
        "day": day,
        "type": "sleep",
        "bedtime_start": "2026-06-21T23:30:00-05:00",
        "bedtime_end": "2026-06-22T06:30:00-05:00",
        "total_sleep_duration": 24000,  # shorter, but has staging
        "deep_sleep_duration": 3600,
        "rem_sleep_duration": 3600,
        "light_sleep_duration": 9000,
    }
    out = oura_api.build({"sleep": [unstaged_long, staged]})
    s = out["sleep"][0]
    # the staged record wins despite being shorter -> stages are real, not zero
    assert s["deep_min"] == 60.0
    assert s["rem_min"] == 60.0
