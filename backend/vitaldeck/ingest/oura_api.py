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


def build(payload: dict[str, list[dict[str, Any]]]) -> dict[str, list[dict[str, Any]]]:
    """pure mapping: oura docs -> our daily_summary + sleep_session dicts. kept
    side-effect-free so it's unit-testable without the network."""
    # pick the main night per day (prefer long_sleep, else the longest record)
    by_day: dict[str, dict[str, Any]] = {}
    for s in payload.get("sleep", []):
        day = s.get("day")
        if not day:
            continue
        dur = _num(s.get("total_sleep_duration")) or 0
        prev = by_day.get(day)
        prev_dur = (_num(prev.get("total_sleep_duration")) or 0) if prev else -1
        if prev is None or s.get("type") == "long_sleep" or dur > prev_dur:
            by_day[day] = s

    sessions: list[dict[str, Any]] = []
    for day, s in by_day.items():
        start_ms = _ms(s.get("bedtime_start"))
        end_ms = _ms(s.get("bedtime_end"))
        if start_ms is None or end_ms is None:
            continue
        sessions.append({
            "date": day,
            "start_ms": start_ms,
            "end_ms": end_ms,
            "total_min": _mins(s.get("total_sleep_duration")),
            "efficiency": _num(s.get("efficiency")),
            "latency_min": _mins(s.get("latency")),
            "deep_min": _mins(s.get("deep_sleep_duration")),
            "rem_min": _mins(s.get("rem_sleep_duration")),
            "light_min": _mins(s.get("light_sleep_duration")),
            "awake_min": _mins(s.get("awake_time")),
            "stages_json": None,
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
                "deep_min": _mins(s.get("deep_sleep_duration")),
                "rem_min": _mins(s.get("rem_sleep_duration")),
                "light_min": _mins(s.get("light_sleep_duration")),
                "awake_min": _mins(s.get("awake_time")),
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
