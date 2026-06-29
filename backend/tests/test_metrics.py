"""asserting baseline means skip None, readiness stays in [0,100], a strained
night scores lower than a normal one, and the temp flag trips at >=0.35C."""
from __future__ import annotations

from vitaldeck.metrics import baselines, readiness


def _summary(date: str, hrv=None, rhr=None, temp=None, sleep_min=None, eff=None) -> dict:
    return {
        "date": date,
        "hrv_rmssd": hrv,
        "resting_hr": rhr,
        "temp_mean_c": temp,
        "sleep_min": sleep_min,
        "sleep_efficiency": eff,
    }


def _history(n: int = 14) -> list[dict]:
    """a steady stretch of normal days to baseline against."""
    out = []
    for i in range(n):
        out.append(_summary(
            f"2026-06-{i+1:02d}",
            hrv=60.0, rhr=55.0, temp=36.0,
            sleep_min=450.0, eff=92.0,
        ))
    return out


def test_baselines_skip_none():
    summaries = [
        _summary("2026-06-01", hrv=60.0, rhr=50.0, temp=36.0),
        _summary("2026-06-02", hrv=None, rhr=None, temp=None),
        _summary("2026-06-03", hrv=80.0, rhr=60.0, temp=37.0),
    ]
    base = baselines.compute_baselines(summaries)

    # the None day should be skipped, so hrv 14d baseline = mean(60,80) = 70
    assert base["hrv_rmssd"]["14"] == 70.0
    assert base["resting_hr"]["14"] == 55.0
    assert base["temp_mean_c"]["14"] == 36.5
    assert base["n_days"] == 3


def test_baselines_all_none_is_none():
    summaries = [_summary("2026-06-01"), _summary("2026-06-02")]
    base = baselines.compute_baselines(summaries)
    assert base["hrv_rmssd"]["14"] is None
    assert base["resting_hr"]["30"] is None


def test_readiness_in_range_and_components():
    hist = _history()
    base = baselines.compute_baselines(hist)
    today = _summary("2026-06-15", hrv=62.0, rhr=54.0, temp=36.0, sleep_min=450.0, eff=92.0)

    result = readiness.compute_readiness(today, base)
    assert 0.0 <= result["score"] <= 100.0
    # all four components present and explainable
    for key in ("hrv", "resting_hr", "temp", "sleep"):
        comp = result["components"][key]
        assert 0.0 <= comp["subscore"] <= 1.0
        assert "weight" in comp and "note" in comp
    assert isinstance(result["explanation"], str)


def test_strained_night_scores_lower():
    hist = _history()
    base = baselines.compute_baselines(hist)

    normal = _summary("2026-06-15", hrv=62.0, rhr=54.0, temp=36.0, sleep_min=450.0, eff=92.0)
    # suppressed hrv + elevated resting hr + a temp bump + worse sleep
    strained = _summary("2026-06-16", hrv=42.0, rhr=63.0, temp=36.5, sleep_min=360.0, eff=80.0)

    normal_score = readiness.compute_readiness(normal, base)["score"]
    strained_score = readiness.compute_readiness(strained, base)["score"]

    assert strained_score < normal_score


def test_readiness_robust_to_missing_baseline():
    # no history at all -> baselines are None; subscores should fall back to 0.5
    base = baselines.compute_baselines([])
    today = _summary("2026-06-15", hrv=60.0, rhr=55.0, temp=36.0, sleep_min=450.0, eff=92.0)

    result = readiness.compute_readiness(today, base)
    assert 0.0 <= result["score"] <= 100.0
    assert result["components"]["hrv"]["note"] == "no baseline yet"
    assert result["components"]["resting_hr"]["note"] == "no baseline yet"


def test_temp_flag_triggers_at_threshold():
    hist = _history()  # temp baseline = 36.0
    base = baselines.compute_baselines(hist)

    # a 0.4C bump should trip the flag
    bumped = _summary("2026-06-16", temp=36.4)
    flag = readiness.temp_flag(bumped, base)
    assert flag["flagged"] is True
    assert flag["deviation"] is not None
    assert abs(flag["deviation"] - 0.4) < 1e-6

    # a 0.2C wobble should not
    calm = _summary("2026-06-16", temp=36.2)
    assert readiness.temp_flag(calm, base)["flagged"] is False


def test_temp_flag_no_baseline():
    base = baselines.compute_baselines([])
    today = _summary("2026-06-16", temp=36.4)
    flag = readiness.temp_flag(today, base)
    assert flag["flagged"] is False
    assert flag["deviation"] is None


def test_temp_zero_baseline_is_neutral():
    # a 0.0 temp baseline is a sentinel for "no baseline yet", not a real reading —
    # it must NOT trip the illness flag nor zero out the temp subscore
    base = {"temp_mean_c": {"14": 0.0, "30": 0.0}, "n_days": 0}
    today = _summary("2026-06-16", temp=36.0)

    flag = readiness.temp_flag(today, base)
    assert flag["flagged"] is False
    assert flag["deviation"] is None
    assert flag["note"] == "no baseline yet"

    result = readiness.compute_readiness(today, base)
    temp_comp = result["components"]["temp"]
    # neutral 0.5 subscore + the "no baseline yet" note, not a zeroed-out subscore
    assert temp_comp["subscore"] == 0.5
    assert temp_comp["note"] == "no baseline yet"


def test_baselines_tolerate_none_date():
    # a row with date=None must not break the defensive sort — the trailing-window
    # means should still reflect the genuinely most-recent days
    summaries = [
        _summary(None, hrv=60.0, rhr=50.0, temp=36.0),
        _summary("2026-06-01", hrv=62.0, rhr=51.0, temp=36.1),
        _summary("2026-06-02", hrv=80.0, rhr=60.0, temp=37.0),
    ]
    base = baselines.compute_baselines(summaries, windows=(2, 30))

    # None-date row sorts first (oldest), so the most-recent 2 are the dated rows
    assert base["hrv_rmssd"]["2"] == 71.0
    assert base["resting_hr"]["2"] == 55.5
    assert abs(base["temp_mean_c"]["2"] - 36.55) < 1e-9
    assert base["n_days"] == 3
