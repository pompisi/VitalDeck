"""feeding summarize a hand-built day and asserting the rolled-up fields plus a
single stitched sleep session."""
from __future__ import annotations

import json

from vitaldeck import config
from vitaldeck import summarize


# building timestamps relative to a known local-midnight so the day-bucketing is
# predictable. offset is config-driven so the test follows a deploy override.
_OFFSET_S = int(config.LOCAL_UTC_OFFSET_HOURS * 3600)
# epoch ms for local midnight of an arbitrary day (day index 20000)
_DAY_INDEX = 20000
_LOCAL_MIDNIGHT_MS = (_DAY_INDEX * 86400 - _OFFSET_S) * 1000


def _ms(hour: float) -> int:
    """ms timestamp for a given local hour-of-day on our test day."""
    return _LOCAL_MIDNIGHT_MS + int(hour * 3600 * 1000)


def _rec(t_ms: int, rtype: str, data: dict, sess: int = 1, ctr: int = 0) -> dict:
    return {
        "t_event_ms": t_ms, "type": rtype, "sess": sess, "ctr": ctr,
        "tag": None, "rt": None, "raw_t": None, "data": data,
    }


def _build_day() -> list[dict]:
    recs: list[dict] = []

    # a night of sleep 1:00-7:00 local. heart rate while asleep (lower) + hrv +
    # temp + spo2 + resp sampled through the night.
    for h in [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]:
        recs.append(_rec(_ms(h), "heart_rate", {"bpm": 52 + int(h), "asleep": True}))
        recs.append(_rec(_ms(h), "hrv", {"rmssd_ms": 60.0 + h}))
        recs.append(_rec(_ms(h), "skin_temp", {"temp_c": 36.0 + h * 0.01}))
        recs.append(_rec(_ms(h), "spo2", {"spo2_pct": 97.0}))
        recs.append(_rec(_ms(h), "resp", {"rpm": 14.0}))

    # daytime heart rate (higher, not asleep)
    for h in [9.0, 12.0, 15.0, 18.0]:
        recs.append(_rec(_ms(h), "heart_rate", {"bpm": 75 + int(h), "asleep": False}))

    # some daytime activity: accel above the step threshold + high-MET minutes
    for h in [10.0, 10.5, 11.0]:
        recs.append(_rec(_ms(h), "accel", {"acm": 2.0}))
        recs.append(_rec(_ms(h), "activity_met", {"met": 5.0}))

    # the hypnogram: a contiguous run of sleep_stage records, latency then deep/
    # rem/light with one awake chunk. each duration_s long enough to be contiguous
    # (gaps under 30 min).
    stage_plan = [
        ("awake", 600),   # 10 min latency
        ("light", 1800),
        ("deep", 2400),
        ("rem", 1800),
        ("light", 1800),
        ("awake", 300),
        ("rem", 1200),
    ]
    t = _ms(1.0)
    for stage, dur in stage_plan:
        recs.append(_rec(t, "sleep_stage", {"stage": stage, "duration_s": dur}))
        t += dur * 1000

    return recs


def test_daily_summary_fields():
    recs = _build_day()
    result = summarize.summarize_records(recs)

    assert len(result["daily"]) == 1
    day = result["daily"][0]

    # resting_hr should be near the low end of the asleep heart rates (53..58)
    assert day["resting_hr"] is not None
    assert 53.0 <= day["resting_hr"] <= 55.0

    # hrv is the mean of the nightly rmssd (61..66 -> 63.5)
    assert day["hrv_rmssd"] is not None
    assert abs(day["hrv_rmssd"] - 63.5) < 0.01

    # temp mean ~36.03x
    assert day["temp_mean_c"] is not None
    assert 36.0 <= day["temp_mean_c"] <= 36.1

    assert day["spo2_avg"] == 97.0
    assert day["resp_rate"] == 14.0

    # hr_min/max span asleep lows and daytime highs
    assert day["hr_min"] == 53.0
    assert day["hr_max"] == 93.0

    # steps heuristic counted the 3 above-threshold accels (2 each)
    assert day["steps"] == 6
    # 3 high-MET minutes
    assert day["met_high_min"] == 3.0

    # sleep fields folded back from the session
    assert day["sleep_min"] is not None and day["sleep_min"] > 0
    breakdown = json.loads(day["stage_breakdown_json"])
    assert breakdown["deep_min"] > 0
    assert breakdown["rem_min"] > 0


def test_sleep_session():
    recs = _build_day()
    result = summarize.summarize_records(recs)

    assert len(result["sleep"]) == 1
    sess = result["sleep"][0]

    # deep = 2400s = 40 min, rem = 1800+1200 = 3000s = 50 min
    assert sess["deep_min"] == 40.0
    assert sess["rem_min"] == 50.0
    # light = 1800+1800 = 3600s = 60 min
    assert sess["light_min"] == 60.0
    # awake = 600+300 = 900s = 15 min
    assert sess["awake_min"] == 15.0

    # latency = 10 min (the leading awake chunk before first light)
    assert sess["latency_min"] == 10.0

    # efficiency = asleep/(asleep+awake) * 100; asleep=150min, awake=15min
    assert sess["efficiency"] is not None
    expected_eff = 150.0 / 165.0 * 100.0
    assert abs(sess["efficiency"] - expected_eff) < 0.5

    # stages_json round-trips to the ordered hypnogram
    stages = json.loads(sess["stages_json"])
    assert stages[0]["stage"] == "awake"
    assert len(stages) == 7

    # the session's date is the local date of its end_ms
    assert sess["date"] is not None
    assert sess["start_ms"] < sess["end_ms"]
