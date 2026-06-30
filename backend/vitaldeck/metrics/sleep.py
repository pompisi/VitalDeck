"""the custom, explainable SLEEP-QUALITY score.

a sibling to readiness.py: oura ships a black-box sleep score, this is ours and
every subscore carries its value, the baseline it was judged against, its weight,
and a human note. score = round(100 * sum(weight * subscore)); subscores live in
[0,1]; missing signals fall back to a neutral 0.5 so a sparse night still scores.

four components — duration (vs target), efficiency, restfulness (restless periods
/ time awake), and timing (tonight's bedtime vs your own recent average, a circular
mean so 23:50 and 00:10 read as close). it is its OWN composite, deliberately NOT
folded into readiness (that weight set stays frozen for comparability).
"""
from __future__ import annotations

import math
from typing import Optional

from vitaldeck import config

# efficiency at/above this reads as full marks (oura treats ~85%+ as healthy)
_EFFICIENCY_TARGET = 90.0
# restless periods at/above this drive the restfulness subscore to 0
_RESTLESS_FULL = 35.0
# fraction of the night awake that drives the awake-fallback subscore to 0
_AWAKE_FULL_FRAC = 0.25
# a bedtime this many minutes off your usual saturates the timing penalty
_BEDTIME_FULL_DEV_MIN = 120.0

_MIN_PER_DAY = 1440.0


def _clamp01(x: float) -> float:
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x


def _num(v) -> Optional[float]:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def local_bedtime_min(start_ms, offset_hours: float = config.LOCAL_UTC_OFFSET_HOURS) -> Optional[float]:
    """local minute-of-day (0..1440) of a bedtime from its epoch-ms start. uses the
    deploy's utc offset so 'bedtime' is wall-clock, not utc."""
    ms = _num(start_ms)
    if ms is None:
        return None
    local_s = ms / 1000.0 + offset_hours * 3600.0
    return (local_s % 86400.0) / 60.0


def _circular_mean_min(mins: list[float]) -> Optional[float]:
    """mean of clock-minutes on a 24h circle (so late-night times average sanely)."""
    pts = [m for m in mins if m is not None]
    if not pts:
        return None
    s = sum(math.sin(m / _MIN_PER_DAY * 2 * math.pi) for m in pts)
    c = sum(math.cos(m / _MIN_PER_DAY * 2 * math.pi) for m in pts)
    if abs(s) < 1e-9 and abs(c) < 1e-9:
        return None
    ang = math.atan2(s, c)
    if ang < 0:
        ang += 2 * math.pi
    # modulo keeps the result in the documented half-open [0,1440) — without it an
    # antipodal/near-midnight mean can land on 1440.0 instead of 0.0
    return (ang / (2 * math.pi) * _MIN_PER_DAY) % _MIN_PER_DAY


def _circular_dev_min(a: float, b: float) -> float:
    """shortest distance between two clock-minutes on the 24h circle (0..720)."""
    d = abs(a - b) % _MIN_PER_DAY
    return min(d, _MIN_PER_DAY - d)


def bedtime_baseline(sessions: list[dict], offset_hours: float = config.LOCAL_UTC_OFFSET_HOURS) -> Optional[float]:
    """your recent typical bedtime (circular mean clock-minute) across sessions —
    the baseline the timing/regularity subscore is judged against."""
    if not isinstance(sessions, list):
        return None
    mins = [local_bedtime_min(s.get("start_ms"), offset_hours) for s in sessions if isinstance(s, dict)]
    return _circular_mean_min([m for m in mins if m is not None])


def _duration_sub(total_min: Optional[float]) -> tuple[float, str, Optional[float]]:
    if total_min is None:
        return 0.5, "no sleep duration", None
    target = config.SLEEP_TARGET_MIN or 1
    # capping at 1.0 — sleeping past target doesn't keep adding score
    sub = _clamp01(total_min / target)
    note = f"{total_min / 60.0:.1f}h vs {target / 60.0:.1f}h target"
    return sub, note, float(target)


def _efficiency_sub(eff: Optional[float]) -> tuple[float, str, Optional[float]]:
    if eff is None:
        return 0.5, "no efficiency reading", None
    sub = _clamp01(eff / _EFFICIENCY_TARGET)
    note = f"{eff:.0f}% sleep efficiency"
    return sub, note, _EFFICIENCY_TARGET


def _restfulness_sub(
    restless: Optional[float], awake_min: Optional[float], inbed_min: Optional[float]
) -> tuple[float, str, Optional[float]]:
    """restless periods are the primary signal (lower = calmer); when oura doesn't
    give them, fall back to the fraction of the night spent awake."""
    if restless is not None:
        sub = _clamp01(1.0 - restless / _RESTLESS_FULL)
        # no personal baseline for restlessness (the threshold isn't one), so leave
        # it null — the UI then shows a clean "VALUE 12" instead of "VALUE 12 · BASE 12"
        return sub, f"{int(round(restless))} restless periods", None
    if awake_min is not None and inbed_min and inbed_min > 0:
        frac = awake_min / inbed_min
        sub = _clamp01(1.0 - frac / _AWAKE_FULL_FRAC)
        return sub, f"{frac * 100:.0f}% of night awake", None
    return 0.5, "no restfulness signal", None


def _timing_sub(bedtime_min: Optional[float], baseline_min: Optional[float]) -> tuple[float, str, Optional[float]]:
    if bedtime_min is None:
        return 0.5, "no bedtime", None
    if baseline_min is None:
        return 0.5, "no bedtime baseline yet", None
    # signed minutes off your usual on the 24h circle (+ later, - earlier). we report
    # the DEVIATION, not an absolute clock, so the note can never disagree with the
    # app's device-timezone bedtime readout — and the subscore is timezone-agnostic.
    signed = ((bedtime_min - baseline_min + _MIN_PER_DAY / 2) % _MIN_PER_DAY) - _MIN_PER_DAY / 2
    dev = abs(signed)
    sub = _clamp01(1.0 - dev / _BEDTIME_FULL_DEV_MIN)
    if dev < 1.0:
        note = "right on your usual bedtime"
    else:
        note = f"{int(round(dev))}m {'later' if signed > 0 else 'earlier'} than your usual bedtime"
    return sub, note, baseline_min


def compute_sleep_quality(
    session: dict,
    bedtime_baseline_min: Optional[float] = None,
    weights=config.SLEEP_QUALITY_WEIGHTS,
) -> dict:
    """assembling the explainable sleep-quality score for one sleep session.

    session is a sleep_session dict (total_min, efficiency, deep/rem/light/awake_min,
    restless_periods, start_ms). bedtime_baseline_min is your recent typical bedtime
    (from bedtime_baseline over the window). returns score (0-100), the per-component
    breakdown, and a one-line explanation. robust to missing fields throughout.
    """
    if not isinstance(session, dict):
        session = {}

    total_min = _num(session.get("total_min"))
    eff = _num(session.get("efficiency"))
    restless = _num(session.get("restless_periods"))
    awake_min = _num(session.get("awake_min"))
    deep = _num(session.get("deep_min")) or 0.0
    rem = _num(session.get("rem_min")) or 0.0
    light = _num(session.get("light_min")) or 0.0
    inbed = deep + rem + light + (awake_min or 0.0)
    bedtime_min = local_bedtime_min(session.get("start_ms"))

    dur_sub, dur_note, dur_base = _duration_sub(total_min)
    eff_sub, eff_note, eff_base = _efficiency_sub(eff)
    rest_sub, rest_note, rest_base = _restfulness_sub(restless, awake_min, inbed)
    time_sub, time_note, time_base = _timing_sub(bedtime_min, bedtime_baseline_min)

    components = {
        "duration": {
            "value": total_min, "baseline": dur_base,
            "subscore": dur_sub, "weight": weights.get("duration", 0.0), "note": dur_note,
        },
        "efficiency": {
            "value": eff, "baseline": eff_base,
            "subscore": eff_sub, "weight": weights.get("efficiency", 0.0), "note": eff_note,
        },
        "restfulness": {
            "value": restless, "baseline": rest_base,
            "subscore": rest_sub, "weight": weights.get("restfulness", 0.0), "note": rest_note,
        },
        # bedtime is a clock time, not a plain number — keep value null so the UI
        # shows the human note (e.g. "bedtime 11:40 PM vs usual 11:15 PM") not "1420"
        "timing": {
            "value": None, "baseline": None,
            "subscore": time_sub, "weight": weights.get("timing", 0.0), "note": time_note,
        },
    }

    total = 0.0
    for comp in components.values():
        try:
            total += float(comp["weight"]) * float(comp["subscore"])
        except (TypeError, ValueError):
            continue
    score = max(0.0, min(100.0, round(100.0 * total)))

    return {"score": score, "components": components, "explanation": _explain(score, components)}


def _explain(score: float, components: dict) -> str:
    """a one-liner naming the biggest drag on the score (mirrors readiness._explain)."""
    worst = None
    worst_lost = None
    for name, comp in components.items():
        try:
            lost = float(comp["weight"]) * (1.0 - float(comp["subscore"]))
        except (TypeError, ValueError):
            continue
        if worst_lost is None or lost > worst_lost:
            worst_lost = lost
            worst = name

    if score >= 80:
        head = "restorative night"
    elif score >= 60:
        head = "decent rest"
    else:
        head = "rough night"

    if worst is not None and worst_lost and worst_lost > 0.02:
        return f"{head} — biggest drag: {components[worst]['note']}"
    return head
