"""a tiny twice-daily background job that runs the same sync routine the
/sync endpoint exposes.

batch-not-live is the whole posture of the project: the ring buffers data and we
sweep it up a couple times a day, so a BackgroundScheduler firing morning +
evening is plenty. in dev (no ADB_TARGET) we no-op — there's nothing to pull and
we don't want a background thread fabricating synthetic days behind the user's
back.
"""
from __future__ import annotations

from typing import Optional

from vitaldeck import config

try:
    from apscheduler.schedulers.background import BackgroundScheduler
except Exception as exc:  # pragma: no cover - apscheduler is a declared dep
    BackgroundScheduler = None  # type: ignore[assignment]
    print(f"[scheduler] apscheduler unavailable: {exc}")

# the times we sweep — morning + evening. cron over the local clock is fine since
# this is one personal box.
SYNC_HOURS = (8, 20)

_scheduler: Optional["BackgroundScheduler"] = None


def _job() -> None:
    """the scheduled tick — defers to the api's shared sync routine."""
    try:
        # importing lazily so building the scheduler doesn't drag in FastAPI
        from vitaldeck.api.main import run_sync

        result = run_sync()
        print(f"[scheduler] sync tick: {result}")
    except Exception as exc:
        print(f"[scheduler] sync tick failed: {exc}")


def _is_dev() -> bool:
    """dev/synthetic == no real data source configured (neither the oura api
    token nor an adb target). when either is set, the twice-daily auto-sync runs."""
    return not config.OURA_TOKEN and not config.ADB_TARGET


def start() -> Optional["BackgroundScheduler"]:
    """starting the twice-daily job. no-ops (returns None) in dev or if
    apscheduler somehow isn't importable, so it's always safe to call."""
    global _scheduler

    if _is_dev():
        print("[scheduler] dev/synthetic mode — not starting background sync")
        return None
    if BackgroundScheduler is None:
        print("[scheduler] no apscheduler — background sync disabled")
        return None
    if _scheduler is not None:
        # already running; don't stack duplicate jobs
        return _scheduler

    try:
        sched = BackgroundScheduler()
        for hour in SYNC_HOURS:
            sched.add_job(
                _job,
                trigger="cron",
                hour=hour,
                minute=0,
                id=f"vitaldeck-sync-{hour}",
                replace_existing=True,
                misfire_grace_time=3600,
            )
        sched.start()
        _scheduler = sched
        print(f"[scheduler] started twice-daily sync at hours {SYNC_HOURS}")
        return sched
    except Exception as exc:
        print(f"[scheduler] failed to start: {exc}")
        _scheduler = None
        return None


def shutdown() -> None:
    """stopping the scheduler if it's running; safe to call unconditionally."""
    global _scheduler
    if _scheduler is None:
        return
    try:
        _scheduler.shutdown(wait=False)
    except Exception as exc:
        print(f"[scheduler] shutdown failed: {exc}")
    finally:
        _scheduler = None
