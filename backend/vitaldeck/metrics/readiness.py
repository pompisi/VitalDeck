"""the custom readiness score.

oura's own readiness is a black box; this is ours, and the whole point is that it
stays explainable — every subscore carries its value, the baseline it was judged
against, the weight it got, and a human note. score = round(100 * sum(weight *
subscore)). subscores live in [0,1]; missing baselines fall back to a neutral 0.5
so a fresh install still produces a number.
"""
from __future__ import annotations

from typing import Optional

from vitaldeck import config

# which baseline window we read for each comparison; 14d is responsive enough for
# day-to-day readiness while still smoothing noise.
_BASELINE_WINDOW = "14"

# temperature deviation (deg C) at/above which we treat the night as a clear
# anomaly — same threshold temp_flag fires on.
_TEMP_FLAG_C = 0.35

# how much the score reacts to relative hrv/rhr swings: a deviation of this
# fraction from baseline saturates the subscore to its 0 or 1 edge.
_HRV_FULL_SWING = 0.30   # +30% hrv -> ~1.0, -30% -> ~0.0
_RHR_FULL_SWING = 0.20   # -20% rhr -> ~1.0, +20% -> ~0.0

# a temp deviation this large drives the temp subscore to 0
_TEMP_FULL_PENALTY_C = 1.0


def _clamp01(x: float) -> float:
    """pinning a value into [0,1]."""
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x


def _baseline_for(baselines: dict, field: str) -> Optional[float]:
    """digging the 14d baseline for a field out of the baselines dict, tolerating
    a missing field/window entirely."""
    try:
        return baselines.get(field, {}).get(_BASELINE_WINDOW)
    except (AttributeError, TypeError):
        return None


def _hrv_subscore(value: Optional[float], baseline: Optional[float]) -> tuple[float, str]:
    """higher hrv vs baseline = better. centering 0.5 at baseline and scaling by
    the relative swing."""
    if value is None:
        return 0.5, "no hrv reading"
    if baseline is None or baseline == 0:
        return 0.5, "no baseline yet"
    rel = (value - baseline) / baseline
    sub = _clamp01(0.5 + 0.5 * (rel / _HRV_FULL_SWING))
    note = f"hrv {value:.0f}ms vs {baseline:.0f}ms baseline"
    return sub, note


def _rhr_subscore(value: Optional[float], baseline: Optional[float]) -> tuple[float, str]:
    """lower resting hr vs baseline = better. note the sign flip vs hrv."""
    if value is None:
        return 0.5, "no resting hr reading"
    if baseline is None or baseline == 0:
        return 0.5, "no baseline yet"
    rel = (value - baseline) / baseline
    # an elevated rhr (positive rel) should drop the subscore, so we subtract
    sub = _clamp01(0.5 - 0.5 * (rel / _RHR_FULL_SWING))
    note = f"resting hr {value:.0f}bpm vs {baseline:.0f}bpm baseline"
    return sub, note


def _temp_subscore(value: Optional[float], baseline: Optional[float]) -> tuple[float, str]:
    """penalizing absolute temperature deviation in either direction — a fever or
    an unusual dip both signal strain."""
    if value is None:
        return 0.5, "no temp reading"
    if baseline is None:
        return 0.5, "no baseline yet"
    dev = abs(value - baseline)
    sub = _clamp01(1.0 - dev / _TEMP_FULL_PENALTY_C)
    note = f"temp deviation {value - baseline:+.2f}C"
    return sub, note


def _sleep_subscore(today: dict) -> tuple[float, str]:
    """blending sleep duration vs the target with efficiency. duration is the
    bigger lever (70%); efficiency rounds it out (30%)."""
    sleep_min = today.get("sleep_min")
    eff = today.get("sleep_efficiency")

    if sleep_min is None and eff is None:
        return 0.5, "no sleep data"

    target = config.SLEEP_TARGET_MIN or 1
    if sleep_min is None:
        dur_sub = 0.5
    else:
        # capping at 1.0 — sleeping past target doesn't keep adding score
        dur_sub = _clamp01(sleep_min / target)

    if eff is None:
        eff_sub = 0.5
    else:
        eff_sub = _clamp01(eff / 100.0)

    sub = 0.7 * dur_sub + 0.3 * eff_sub
    if sleep_min is not None:
        note = f"{sleep_min/60.0:.1f}h sleep" + (f", {eff:.0f}% efficiency" if eff is not None else "")
    else:
        note = f"{eff:.0f}% efficiency"
    return _clamp01(sub), note


def compute_readiness(today: dict, baselines: dict, weights=config.READINESS_WEIGHTS) -> dict:
    """assembling the composite readiness score from its four subscores.

    today is a daily_summary dict; baselines is compute_baselines output. returns
    score (0-100), the per-component breakdown, and a one-line explanation.
    robust to None baselines and missing today fields throughout.
    """
    if not isinstance(today, dict):
        today = {}
    if not isinstance(baselines, dict):
        baselines = {}

    hrv_v = today.get("hrv_rmssd")
    rhr_v = today.get("resting_hr")
    temp_v = today.get("temp_mean_c")

    hrv_base = _baseline_for(baselines, "hrv_rmssd")
    rhr_base = _baseline_for(baselines, "resting_hr")
    temp_base = _baseline_for(baselines, "temp_mean_c")

    hrv_sub, hrv_note = _hrv_subscore(hrv_v, hrv_base)
    rhr_sub, rhr_note = _rhr_subscore(rhr_v, rhr_base)
    temp_sub, temp_note = _temp_subscore(temp_v, temp_base)
    sleep_sub, sleep_note = _sleep_subscore(today)

    components = {
        "hrv": {
            "value": hrv_v, "baseline": hrv_base,
            "subscore": hrv_sub, "weight": weights.get("hrv", 0.0), "note": hrv_note,
        },
        "resting_hr": {
            "value": rhr_v, "baseline": rhr_base,
            "subscore": rhr_sub, "weight": weights.get("resting_hr", 0.0), "note": rhr_note,
        },
        "temp": {
            "value": temp_v, "baseline": temp_base,
            "subscore": temp_sub, "weight": weights.get("temp", 0.0), "note": temp_note,
        },
        "sleep": {
            "value": today.get("sleep_min"), "baseline": None,
            "subscore": sleep_sub, "weight": weights.get("sleep", 0.0), "note": sleep_note,
        },
    }

    total = 0.0
    for comp in components.values():
        try:
            total += float(comp["weight"]) * float(comp["subscore"])
        except (TypeError, ValueError):
            continue
    score = round(100.0 * total)
    # pinning into [0,100] just in case weights don't sum to exactly 1.0
    score = max(0.0, min(100.0, float(score)))

    explanation = _explain(score, components)

    return {"score": score, "components": components, "explanation": explanation}


def _explain(score: float, components: dict) -> str:
    """writing a one-liner that names the biggest drag on the score so the number
    isn't a mystery."""
    # finding the lowest-scoring weighted component to call out
    worst = None
    worst_contrib = None
    for name, comp in components.items():
        try:
            # how much headroom this component is losing: weight * (1 - subscore)
            lost = float(comp["weight"]) * (1.0 - float(comp["subscore"]))
        except (TypeError, ValueError):
            continue
        if worst_contrib is None or lost > worst_contrib:
            worst_contrib = lost
            worst = name

    if score >= 80:
        head = "primed"
    elif score >= 60:
        head = "ok, take it steady"
    else:
        head = "go easy today"

    if worst is not None and worst_contrib and worst_contrib > 0.02:
        return f"{head} — biggest drag: {components[worst]['note']}"
    return head


def temp_flag(today: dict, baselines: dict) -> dict:
    """flagging an out-of-band skin-temperature night. |deviation| >= 0.35C from
    the 14d baseline trips the flag — the classic early illness / strain signal.
    """
    if not isinstance(today, dict):
        today = {}
    value = today.get("temp_mean_c")
    base = _baseline_for(baselines if isinstance(baselines, dict) else {}, "temp_mean_c")

    if value is None or base is None:
        return {"flagged": False, "deviation": None, "note": "no baseline yet"}

    dev = value - base
    flagged = abs(dev) >= _TEMP_FLAG_C
    if flagged:
        note = f"temp {dev:+.2f}C off baseline — watch for illness/strain"
    else:
        note = f"temp {dev:+.2f}C off baseline — within normal range"
    return {"flagged": flagged, "deviation": dev, "note": note}
