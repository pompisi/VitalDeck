"""oura cloud api ingest — the no-debugging, no-snoop-log path to real data while
a membership/trial is active. pulls the v2 usercollection endpoints with a
personal access token and maps them onto our daily_summaries + sleep_sessions, so
the same baselines/readiness math runs no matter where the data came from.

stdlib-only (urllib) so the backend gains no runtime dependency. every network
hop is wrapped — failures surface as OuraError and never crash the api.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from vitaldeck import config
from vitaldeck.db import store


class OuraError(RuntimeError):
    pass


def _get(path: str, token: str, params: dict[str, str]) -> dict[str, Any]:
    """one authenticated GET against the oura v2 api, returning parsed json."""
    url = f"{config.OURA_API_BASE}/{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=config.OURA_TIMEOUT_S) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8")[:200]
        except Exception:
            pass
        raise OuraError(f"oura {path} HTTP {exc.code}: {detail}") from exc
    except Exception as exc:
        raise OuraError(f"oura {path} request failed: {exc}") from exc
    try:
        return json.loads(body)
    except ValueError as exc:
        raise OuraError(f"oura {path} returned bad json: {exc}") from exc


def _rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    data = payload.get("data") if isinstance(payload, dict) else None
    return data if isinstance(data, list) else []


def _ms(iso: Optional[str]) -> Optional[int]:
    """oura timestamps are iso8601 with offset; -> epoch ms."""
    if not iso:
        return None
    try:
        return int(datetime.fromisoformat(iso).timestamp() * 1000)
    except Exception:
        return None


def _num(v: Any) -> Optional[float]:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _mins(sec: Any) -> Optional[float]:
    n = _num(sec)
    return round(n / 60, 1) if n is not None else None


# oura's 5-minute hypnogram (`sleep_phase_5_min`): one char per 5-min window,
# 1=deep 2=light 3=rem 4=awake. it's the staging fallback for nights whose
# explicit *_duration fields come back null (the cause of "stages read 0").
_HYPNO_STAGE = {"1": "deep", "2": "light", "3": "rem", "4": "awake"}
_HYPNO_WINDOW_S = 300  # each char = 5 minutes


def _hypnogram_minutes(phase: Any) -> Optional[dict[str, float]]:
    """deriving per-stage minutes from a sleep_phase_5_min string. returns None if
    the field is absent/empty/unrecognized so callers fall back cleanly."""
    if not isinstance(phase, str) or not phase:
        return None
    counts = {"deep": 0.0, "light": 0.0, "rem": 0.0, "awake": 0.0}
    seen = False
    for ch in phase:
        stage = _HYPNO_STAGE.get(ch)
        if stage is None:
            continue
        counts[stage] += 5.0
        seen = True
    if not seen:
        return None
    return {
        "deep_min": counts["deep"],
        "rem_min": counts["rem"],
        "light_min": counts["light"],
        "awake_min": counts["awake"],
    }


def _hypnogram_stages(phase: Any) -> Optional[list[dict[str, Any]]]:
    """run-length expanding sleep_phase_5_min into our stages_json shape
    ([{stage, duration_s}, ...]). None when the hypnogram is absent — keeps the
    api path's stages_json null rather than fabricating an empty list."""
    if not isinstance(phase, str) or not phase:
        return None
    runs: list[dict[str, Any]] = []
    for ch in phase:
        stage = _HYPNO_STAGE.get(ch)
        if stage is None:
            continue
        if runs and runs[-1]["stage"] == stage:
            runs[-1]["duration_s"] += _HYPNO_WINDOW_S
        else:
            runs.append({"stage": stage, "duration_s": _HYPNO_WINDOW_S})
    return runs or None


def _stage_minutes(s: dict[str, Any]) -> dict[str, Optional[float]]:
    """deep/rem/light/awake minutes for one oura sleep record. prefers the explicit
    *_duration fields; when all the staged ones are missing (some nights/records
    only carry the hypnogram), derives them from sleep_phase_5_min instead."""
    deep = _mins(s.get("deep_sleep_duration"))
    rem = _mins(s.get("rem_sleep_duration"))
    light = _mins(s.get("light_sleep_duration"))
    awake = _mins(s.get("awake_time"))
    if deep is None and rem is None and light is None:
        hyp = _hypnogram_minutes(s.get("sleep_phase_5_min"))
        if hyp is not None:
            deep = hyp["deep_min"]
            rem = hyp["rem_min"]
            light = hyp["light_min"]
            awake = awake if awake is not None else hyp["awake_min"]
    return {"deep_min": deep, "rem_min": rem, "light_min": light, "awake_min": awake}


def _has_stages(s: dict[str, Any]) -> bool:
    """does this record carry usable staging — explicit durations or a hypnogram?"""
    if any(
        s.get(k) is not None
        for k in ("deep_sleep_duration", "rem_sleep_duration", "light_sleep_duration")
    ):
        return True
    phase = s.get("sleep_phase_5_min")
    return isinstance(phase, str) and bool(phase)


def _night_rank(s: dict[str, Any]) -> tuple[int, int, float]:
    """ranking key for picking the main night per day: prefer a record that
    actually has staging, then a long_sleep, then the longest. picking a staged
    record over a longer un-staged one is what keeps DEEP/REM/LIGHT off zero."""
    has = 1 if _has_stages(s) else 0
    is_long = 1 if s.get("type") == "long_sleep" else 0
    dur = _num(s.get("total_sleep_duration")) or 0.0
    return (has, is_long, dur)


def fetch(token: str, days: int = 30) -> dict[str, list[dict[str, Any]]]:
    """pulling the endpoints we map, over the trailing <days> window. sleep is
    required; the rest are best-effort (device/plan dependent)."""
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=days)
    p = {"start_date": start.isoformat(), "end_date": end.isoformat()}
    out: dict[str, list[dict[str, Any]]] = {"sleep": _rows(_get("sleep", token, p))}
    for ep in ("daily_readiness", "daily_spo2", "daily_activity"):
        try:
            out[ep] = _rows(_get(ep, token, p))
        except OuraError as exc:
            print(f"[oura] {ep} skipped: {exc}")
            out[ep] = []
    return out


def _sample_series(block: Any) -> Optional[dict[str, Any]]:
    """compacting an oura /sleep time-series block {interval, items, timestamp} into
    {t0_ms, interval_s, values:[float|null]} (nulls preserved as line breaks). these
    are the 5-min overnight HR / HRV curves. returns None when absent/empty."""
    if not isinstance(block, dict):
        return None
    items = block.get("items")
    if not isinstance(items, list) or not items:
        return None
    t0 = _ms(block.get("timestamp"))
    iv = _num(block.get("interval"))
    if t0 is None or iv is None:
        return None
    values = [float(x) if isinstance(x, (int, float)) else None for x in items]
    return {"t0_ms": t0, "interval_s": int(iv), "values": values}


def _rem_latency(phase: Any) -> Optional[float]:
    """minutes from sleep onset (first non-awake stage) to the first REM run, read
    off the 5-min hypnogram string. None if there's no onset or no REM."""
    if not isinstance(phase, str) or not phase:
        return None
    onset = first_rem = None
    for i, ch in enumerate(phase):
        st = _HYPNO_STAGE.get(ch)
        if st is None:
            continue
        if onset is None and st in ("deep", "light", "rem"):
            onset = i
        if first_rem is None and st == "rem":
            first_rem = i
    if onset is None or first_rem is None:
        return None
    return round((first_rem - onset) * 5.0, 1)


def build(payload: dict[str, list[dict[str, Any]]]) -> dict[str, list[dict[str, Any]]]:
    """pure mapping: oura docs -> our daily_summary + sleep_session dicts. kept
    side-effect-free so it's unit-testable without the network."""
    # pick the main night per day: collect every record for the day, then choose
    # by _night_rank (staged > long_sleep > longest). picking by rank instead of
    # "longest or any long_sleep" stops an un-staged record shadowing a staged one.
    by_day_lists: dict[str, list[dict[str, Any]]] = {}
    for s in payload.get("sleep", []):
        day = s.get("day")
        if not day:
            continue
        by_day_lists.setdefault(day, []).append(s)
    by_day: dict[str, dict[str, Any]] = {
        day: max(recs, key=_night_rank) for day, recs in by_day_lists.items()
    }

    sessions: list[dict[str, Any]] = []
    for day, s in by_day.items():
        start_ms = _ms(s.get("bedtime_start"))
        end_ms = _ms(s.get("bedtime_end"))
        if start_ms is None or end_ms is None:
            continue
        sm = _stage_minutes(s)
        # overnight HR/HRV curves + 30-sec movement, compacted into one json blob
        series: dict[str, Any] = {}
        hr_series = _sample_series(s.get("heart_rate"))
        hrv_series = _sample_series(s.get("hrv"))
        if hr_series:
            series["hr"] = hr_series
        if hrv_series:
            series["hrv"] = hrv_series
        mv = s.get("movement_30_sec")
        if isinstance(mv, str) and mv:
            series["movement"] = mv
        restless = _num(s.get("restless_periods"))
        sessions.append({
            "date": day,
            "start_ms": start_ms,
            "end_ms": end_ms,
            "total_min": _mins(s.get("total_sleep_duration")),
            "efficiency": _num(s.get("efficiency")),
            "latency_min": _mins(s.get("latency")),
            "deep_min": sm["deep_min"],
            "rem_min": sm["rem_min"],
            "light_min": sm["light_min"],
            "awake_min": sm["awake_min"],
            # populated from the 5-min hypnogram when oura provides it; else null
            "stages_json": _hypnogram_stages(s.get("sleep_phase_5_min")),
            # the overnight curves (exposed by the API as `series`); null if absent
            "series_json": json.dumps(series) if series else None,
            "restless_periods": int(restless) if restless is not None else None,
            "rem_latency_min": _rem_latency(s.get("sleep_phase_5_min")),
        })

    readiness = {r.get("day"): r for r in payload.get("daily_readiness", []) if r.get("day")}
    spo2 = {r.get("day"): r for r in payload.get("daily_spo2", []) if r.get("day")}
    activity = {r.get("day"): r for r in payload.get("daily_activity", []) if r.get("day")}

    daily: list[dict[str, Any]] = []
    for day, s in by_day.items():
        rd = readiness.get(day, {})
        sp = spo2.get(day, {})
        ac = activity.get(day, {})

        temp_dev = _num(rd.get("temperature_deviation"))
        temp_mean = config.NOMINAL_TEMP_BASELINE_C + temp_dev if temp_dev is not None else None

        spo2_avg = None
        block = sp.get("spo2_percentage")
        if isinstance(block, dict):
            spo2_avg = _num(block.get("average"))

        steps = _num(ac.get("steps"))
        sm = _stage_minutes(s)

        daily.append({
            "date": day,
            "resting_hr": _num(s.get("lowest_heart_rate")),
            "hr_min": _num(s.get("lowest_heart_rate")),
            "hr_max": None,
            "hr_avg_day": _num(s.get("average_heart_rate")),
            "hrv_rmssd": _num(s.get("average_hrv")),
            "spo2_avg": spo2_avg,
            "resp_rate": _num(s.get("average_breath")),
            "temp_mean_c": round(temp_mean, 2) if temp_mean is not None else None,
            "sleep_min": _mins(s.get("total_sleep_duration")),
            "sleep_efficiency": _num(s.get("efficiency")),
            "sleep_latency_min": _mins(s.get("latency")),
            "stage_breakdown_json": json.dumps({
                "deep_min": sm["deep_min"],
                "rem_min": sm["rem_min"],
                "light_min": sm["light_min"],
                "awake_min": sm["awake_min"],
            }),
            "steps": int(steps) if steps is not None else None,
            "met_high_min": _mins(ac.get("high_activity_time")),
            "source_sync_run_id": None,
        })

    return {"daily": daily, "sleep": sessions}


def ingest_oura(conn, token: str, days: int = 30) -> dict[str, int]:
    """fetch -> map -> upsert daily_summaries + sleep_sessions. returns counts."""
    if not token:
        raise OuraError("no oura token configured")
    built = build(fetch(token, days))

    n_daily = 0
    for row in built["daily"]:
        try:
            store.upsert_daily_summary(conn, row)
            n_daily += 1
        except Exception as exc:
            print(f"[oura] upsert daily {row.get('date')} failed: {exc}")

    n_sleep = 0
    for sess in built["sleep"]:
        try:
            store.upsert_sleep_session(conn, sess)
            n_sleep += 1
        except Exception as exc:
            print(f"[oura] upsert sleep {sess.get('date')} failed: {exc}")

    return {"ingested": n_daily, "deduped": 0, "sleep_sessions": n_sleep}


# --- live heart rate ------------------------------------------------------
# the ONLY metric oura's cloud exposes intraday: the /heartrate time series (5-min
# daytime samples, denser during workouts). everything else (hrv, spo2, temp, sleep)
# is nightly-only from the cloud. this powers the app's live-ish HR readout. "live"
# here means "as fresh as the ring's last upload to the oura app" — usually minutes.


def _hr_ts_ms(s: dict[str, Any]) -> Optional[int]:
    """epoch ms for one heartrate sample. prefers the measurement `timestamp`
    (iso8601, possibly 'Z'-suffixed), falling back to `producer_timestamp` (ms)."""
    ts = s.get("timestamp")
    if isinstance(ts, str):
        try:
            return int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() * 1000)
        except Exception:
            pass
    pt = s.get("producer_timestamp")
    try:
        return int(pt) if pt is not None else None
    except (TypeError, ValueError):
        return None


def fetch_heartrate(token: str, hours: int = 6) -> list[dict[str, Any]]:
    """pulling the trailing <hours> of heartrate samples from the oura v2 api. this
    endpoint takes start_datetime/end_datetime (not start_date/end_date)."""
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=hours)
    params = {"start_datetime": start.isoformat(), "end_datetime": end.isoformat()}
    return _rows(_get("heartrate", token, params))


def summarize_heartrate(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """pure: latest HR (smoothed over the trailing ~2 min so a single spiky sample
    doesn't dominate) + the window's min/max/avg over non-sleep samples. bpm is None
    when there are no usable samples (ring hasn't synced recently)."""
    samples: list[tuple[int, float, Optional[str]]] = []
    for s in rows:
        bpm = _num(s.get("bpm"))
        ms = _hr_ts_ms(s)
        if bpm is None or ms is None:
            continue
        samples.append((ms, bpm, s.get("source")))
    if not samples:
        return {"bpm": None, "ts_ms": None, "source": None,
                "day_min": None, "day_max": None, "day_avg": None, "count": 0}
    samples.sort(key=lambda x: x[0])
    latest_ms, latest_bpm, latest_src = samples[-1]
    recent = [b for (ms, b, _s) in samples if latest_ms - ms <= 120_000]
    cur = round(sum(recent) / len(recent)) if recent else round(latest_bpm)
    pool = [b for (_m, b, src) in samples if src != "sleep"] or [b for (_m, b, _s) in samples]
    return {
        "bpm": int(cur),
        "ts_ms": int(latest_ms),
        "source": latest_src,
        "day_min": int(round(min(pool))),
        "day_max": int(round(max(pool))),
        "day_avg": int(round(sum(pool) / len(pool))),
        "count": len(samples),
    }


def live_heartrate(token: str, window_hours: int = 6) -> dict[str, Any]:
    """fetch + summarize the latest live HR. raises OuraError on a network failure
    (the api layer catches it and returns ok=false)."""
    if not token:
        raise OuraError("no oura token configured")
    return summarize_heartrate(fetch_heartrate(token, hours=window_hours))


# --- full-day heart-rate curve --------------------------------------------
# the daytime HR graph: the whole local day's /heartrate samples, 5-min bucketed.


def fetch_heartrate_day(token: str, day: Optional[str] = None) -> list[dict[str, Any]]:
    """pulling one LOCAL day's heartrate samples. day is 'YYYY-MM-DD' (defaults to
    local today). day boundaries use config.LOCAL_UTC_OFFSET_HOURS; today's window
    ends at now."""
    off = timedelta(hours=config.LOCAL_UTC_OFFSET_HOURS)
    now = datetime.now(timezone.utc)
    base = now + off
    if day:
        try:
            base = datetime.strptime(day, "%Y-%m-%d")
        except ValueError:
            base = now + off
    local_mid = datetime(base.year, base.month, base.day, tzinfo=timezone.utc) - off
    start = local_mid
    end = min(local_mid + timedelta(days=1), now)
    params = {"start_datetime": start.isoformat(), "end_datetime": end.isoformat()}
    return _rows(_get("heartrate", token, params))


def summarize_heartrate_series(rows: list[dict[str, Any]], max_points: int = 288) -> dict[str, Any]:
    """pure: bucket daytime (non-sleep) HR samples into 5-min means for a smooth
    curve, plus min/max/avg. returns empty points when nothing's available."""
    samples: list[tuple[int, float]] = []
    for s in rows:
        if s.get("source") == "sleep":
            continue
        bpm = _num(s.get("bpm"))
        ms = _hr_ts_ms(s)
        if bpm is None or ms is None:
            continue
        samples.append((ms, bpm))
    if not samples:
        return {"points": [], "min": None, "max": None, "avg": None, "count": 0}
    buckets: dict[int, list[float]] = {}
    for ms, bpm in samples:
        buckets.setdefault(ms // 300_000, []).append(bpm)
    pts = [
        {"ts_ms": int(k * 300_000), "bpm": int(round(sum(v) / len(v)))}
        for k, v in sorted(buckets.items())
    ]
    if len(pts) > max_points:
        stride = len(pts) // max_points + 1
        pts = pts[::stride]
    vals = [p["bpm"] for p in pts]
    return {
        "points": pts,
        "min": min(vals),
        "max": max(vals),
        "avg": int(round(sum(vals) / len(vals))),
        "count": len(samples),
    }


def day_heartrate(token: str, day: Optional[str] = None) -> dict[str, Any]:
    """fetch + summarize one day's HR curve. raises OuraError on network failure."""
    if not token:
        raise OuraError("no oura token configured")
    return summarize_heartrate_series(fetch_heartrate_day(token, day))
