"""rolling personal baselines.

readiness compares "today" against the owner's own recent history, not a
population norm — so we keep simple trailing means over the configured windows.
each baseline skips None values so a sensor gap doesn't poison the average.
"""
from __future__ import annotations

from typing import Optional

from vitaldeck import config

# the summary fields we baseline. resting_hr/hrv/temp drive the readiness math.
_BASELINE_FIELDS = ("hrv_rmssd", "resting_hr", "temp_mean_c")


def _trailing_mean(values: list, window: int) -> Optional[float]:
    """meaning the most recent <window> non-None values. returns None when the
    window has nothing usable."""
    recent = values[-window:] if window > 0 else values
    clean = [v for v in recent if v is not None]
    if not clean:
        return None
    try:
        return sum(clean) / len(clean)
    except (TypeError, ZeroDivisionError):
        return None


def compute_baselines(summaries: list[dict], windows=config.BASELINE_WINDOWS) -> dict:
    """building trailing-mean baselines per field per window.

    summaries should be ascending by date (oldest first) so the window slices the
    correct tail; we don't re-sort here to avoid surprising the caller, but we
    tolerate any ordering by sorting defensively when a 'date' key is present.

    returns {field: {str(window): float|None}, "n_days": int}.
    """
    if summaries:
        # sorting defensively so "most recent <window>" is honored regardless of
        # how the caller handed them to us
        try:
            # a dateless/None row can't be claimed as recent, so it sorts to the
            # FRONT (oldest) and never displaces a genuinely-dated day from the
            # trailing window. ('date is not None' -> False sorts before True.)
            summaries = sorted(summaries, key=lambda s: (s.get("date") is not None, s.get("date") or ""))
        except Exception:  # noqa: BLE001 — never let a weird row break baselining
            pass

    out: dict = {}
    for field in _BASELINE_FIELDS:
        # collecting the column across all days, keeping None placeholders so the
        # trailing-window slice lines up with the real day count
        values = [s.get(field) for s in summaries]
        out[field] = {str(w): _trailing_mean(values, w) for w in windows}

    out["n_days"] = len(summaries)
    return out
