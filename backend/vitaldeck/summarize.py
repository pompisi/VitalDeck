"""bridging raw_records -> daily_summaries + sleep_sessions.

this is the projection layer: it takes the firehose of canonical records (the
section-1 table in CONTRACTS.md) and rolls them up into one daily_summary per
local day plus one sleep_session per contiguous hypnogram run. everything here is
pure-ish — summarize_records is side-effect-free, rebuild_all is the only piece
that touches the store.
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

from vitaldeck import config

# local-day offset in seconds; grouping records into "days" needs a timezone and
# we read it once here so a deploy-time override flows through.
_OFFSET_S = int(config.LOCAL_UTC_OFFSET_HOURS * 3600)

# anything at/below this MET counts as resting; above it is "active" minutes.
_MET_HIGH_THRESHOLD = 3.0

# accel magnitude that roughly corresponds to a footfall; the step heuristic is a
# crude stand-in (no real pedometer in the decoded stream) and documented as such.
_ACCEL_STEP_THRESHOLD = 1.2


def _local_day(t_event_ms: int) -> str:
    """returning the local YYYY-MM-DD a timestamp falls in, using the configured
    offset. floor-dividing into day buckets the same way CONTRACTS §1 specifies,
    then formatting back to a date string."""
    day_index = (t_event_ms // 1000 + _OFFSET_S) // 86400
    # rebuilding a date from the day index by adding offset onto epoch
    base = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(days=day_index)
    return base.strftime("%Y-%m-%d")


def _percentile(values: list[float], pct: float) -> Optional[float]:
    """small nearest-rank percentile so we avoid a numpy dep. returns None on an
    empty list. pct is 0-100."""
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    # linear-interpolation between closest ranks
    rank = (pct / 100.0) * (len(ordered) - 1)
    lo = int(rank)
    hi = min(lo + 1, len(ordered) - 1)
    frac = rank - lo
    return ordered[lo] + (ordered[hi] - ordered[lo]) * frac


def _mean(values: list[float]) -> Optional[float]:
    """plain mean, None when there's nothing to average."""
    if not values:
        return None
    return sum(values) / len(values)


def _bucket_by_day(records: list[dict]) -> dict[str, list[dict]]:
    """grouping every record under its local day. defensive against a missing or
    junk t_event_ms — such records just get skipped."""
    days: dict[str, list[dict]] = defaultdict(list)
    for rec in records:
        try:
            t = int(rec["t_event_ms"])
        except (KeyError, TypeError, ValueError):
            continue
        days[_local_day(t)].append(rec)
    return days


def _data(rec: dict) -> dict:
    """pulling the typed payload, tolerating records whose data isn't a dict."""
    d = rec.get("data")
    return d if isinstance(d, dict) else {}


def _summarize_day(date: str, recs: list[dict]) -> Optional[dict]:
    """rolling one day's DAYTIME records into a daily_summary dict keyed exactly to
    the daily_summaries columns.

    nightly asleep-derived metrics (resting_hr, hrv_rmssd, spo2_avg, resp_rate,
    temp_mean_c) are NOT computed here — a night that straddles local midnight would
    otherwise get split across two day buckets. those land later in
    summarize_records, attributed to the sleep session's (end) date. here we only
    keep what's genuinely per-local-day: daytime hr, steps, met minutes.

    returns None when a local day has no real daytime/activity data of its own —
    i.e. it only holds nightly samples that have leaked across midnight and belong
    to a session attributed to another date. that prevents a phantom pre-midnight
    row.
    """
    day_hr: list[float] = []
    steps = 0
    met_high_s = 0.0
    # has this day got any record that genuinely belongs to it (a daytime/activity
    # sample)? if all we ever see is leaked nightly stuff, we return None below.
    has_daytime = False

    for rec in recs:
        rtype = rec.get("type")
        d = _data(rec)
        try:
            if rtype == "heart_rate":
                # only the awake (daytime) heart rate is a per-day signal; the
                # asleep samples belong to a session and get rolled up there.
                if not d.get("asleep"):
                    bpm = float(d["bpm"])
                    day_hr.append(bpm)
                    has_daytime = True
            elif rtype == "accel":
                # crude pedometer: each above-threshold accel sample ~= a stride
                has_daytime = True
                if float(d["acm"]) >= _ACCEL_STEP_THRESHOLD:
                    steps += 2
            elif rtype == "activity_met":
                has_daytime = True
                met = float(d["met"])
                if met >= _MET_HIGH_THRESHOLD:
                    # met bins arrive ~1/min in the synth; counting a minute each
                    met_high_s += 60.0
        except (KeyError, TypeError, ValueError):
            # one malformed payload shouldn't sink the whole day's summary
            continue

    if not has_daytime:
        # nothing here but leaked nightly samples — no row of its own
        return None

    return {
        "date": date,
        # nightly asleep-derived metrics start empty; folded in per sleep session
        "resting_hr": None,
        # hr_min/hr_max start from the daytime span and get widened by the night's
        # asleep samples when a session is attributed to this date.
        "hr_min": min(day_hr) if day_hr else None,
        "hr_max": max(day_hr) if day_hr else None,
        "hr_avg_day": _mean(day_hr),
        "hrv_rmssd": None,
        "spo2_avg": None,
        "resp_rate": None,
        "temp_mean_c": None,
        # sleep fields get filled in once sessions are attributed to this day
        "sleep_min": None,
        "sleep_efficiency": None,
        "sleep_latency_min": None,
        "stage_breakdown_json": None,
        "steps": int(steps),
        "met_high_min": met_high_s / 60.0,
    }


def _nightly_metrics(records: list[dict], start_ms: int, end_ms: int) -> dict:
    """computing the asleep-derived nightly metrics from the records that fall
    inside one stitched sleep window [start_ms, end_ms].

    pulling asleep heart_rate (-> resting_hr + the night's hr extremes), hrv, spo2,
    resp and skin_temp from the whole night regardless of which local day each
    sample lands in, so a cross-midnight night reads as a single coherent night.
    """
    asleep_hr: list[float] = []
    rmssd: list[float] = []
    temp: list[float] = []
    spo2: list[float] = []
    resp: list[float] = []

    for rec in records:
        rtype = rec.get("type")
        try:
            t = int(rec["t_event_ms"])
        except (KeyError, TypeError, ValueError):
            continue
        if t < start_ms or t > end_ms:
            continue
        d = _data(rec)
        try:
            if rtype == "heart_rate":
                if d.get("asleep"):
                    asleep_hr.append(float(d["bpm"]))
            elif rtype == "hrv":
                rmssd.append(float(d["rmssd_ms"]))
            elif rtype == "skin_temp":
                temp.append(float(d["temp_c"]))
            elif rtype == "spo2":
                spo2.append(float(d["spo2_pct"]))
            elif rtype == "resp":
                resp.append(float(d["rpm"]))
        except (KeyError, TypeError, ValueError):
            # one malformed payload shouldn't sink the night's rollup
            continue

    return {
        "resting_hr": _percentile(asleep_hr, 5.0),
        "asleep_hr": asleep_hr,
        "hrv_rmssd": _mean(rmssd),
        "spo2_avg": _mean(spo2),
        "resp_rate": _mean(resp),
        "temp_mean_c": _mean(temp),
    }


def _build_sleep_sessions(records: list[dict]) -> list[dict]:
    """stitching contiguous sleep_stage runs into sessions.

    sleep_stage records carry a per-record duration_s; we sort them by event time
    and split into a new session whenever there's a gap larger than the previous
    stage's own duration (plus slack) — i.e. the ring stopped reporting, which
    means the person was awake/off-ring between sleeps.
    """
    stages = [r for r in records if r.get("type") == "sleep_stage"]
    if not stages:
        return []

    def _t(r: dict) -> int:
        try:
            return int(r["t_event_ms"])
        except (KeyError, TypeError, ValueError):
            return 0

    stages.sort(key=_t)

    runs: list[list[dict]] = []
    current: list[dict] = []
    prev_end_ms: Optional[int] = None

    for rec in stages:
        d = _data(rec)
        try:
            dur_s = int(d["duration_s"])
        except (KeyError, TypeError, ValueError):
            dur_s = 0
        start_ms = _t(rec)
        if prev_end_ms is not None:
            gap = start_ms - prev_end_ms
            # tolerating a 30-min gap inside one night (brief awakenings, jitter);
            # a bigger hole means a separate session.
            if gap > 30 * 60 * 1000:
                runs.append(current)
                current = []
        current.append(rec)
        prev_end_ms = start_ms + dur_s * 1000

    if current:
        runs.append(current)

    sessions = []
    for run in runs:
        sess = _session_from_run(run)
        if sess is not None:
            sessions.append(sess)
    return sessions


def _session_from_run(run: list[dict]) -> Optional[dict]:
    """turning one contiguous run of sleep_stage records into a sleep_session
    dict (matching the sleep_sessions columns)."""
    if not run:
        return None

    def _t(r: dict) -> int:
        try:
            return int(r["t_event_ms"])
        except (KeyError, TypeError, ValueError):
            return 0

    deep_s = rem_s = light_s = awake_s = 0
    stages_json: list[dict] = []
    first_t = _t(run[0])
    last_end = first_t

    latency_ms: Optional[int] = None

    for rec in run:
        d = _data(rec)
        stage = d.get("stage")
        try:
            dur_s = int(d["duration_s"])
        except (KeyError, TypeError, ValueError):
            dur_s = 0
        t = _t(rec)
        last_end = t + dur_s * 1000

        stages_json.append({"stage": stage, "duration_s": dur_s})

        if stage == "deep":
            deep_s += dur_s
        elif stage == "rem":
            rem_s += dur_s
        elif stage == "light":
            light_s += dur_s
        elif stage == "awake":
            awake_s += dur_s

        # latency = start of session to first non-awake stage
        if latency_ms is None and stage in ("deep", "rem", "light"):
            latency_ms = t - first_t

    asleep_s = deep_s + rem_s + light_s
    in_bed_s = asleep_s + awake_s
    efficiency = (asleep_s / in_bed_s * 100.0) if in_bed_s > 0 else None
    if latency_ms is None:
        latency_ms = 0

    start_ms = first_t
    end_ms = last_end
    # the session's date is the local date of its end_ms (CONTRACTS §1)
    date = _local_day(end_ms)

    return {
        "date": date,
        "start_ms": start_ms,
        "end_ms": end_ms,
        "total_min": asleep_s / 60.0,
        "efficiency": efficiency,
        "latency_min": latency_ms / 1000.0 / 60.0,
        "deep_min": deep_s / 60.0,
        "rem_min": rem_s / 60.0,
        "light_min": light_s / 60.0,
        "awake_min": awake_s / 60.0,
        "stages_json": json.dumps(stages_json),
    }


def summarize_records(records: list[dict]) -> dict:
    """summarizing a flat list of canonical records into daily summaries +
    sleep sessions. pure: no store, no clock, safe to unit-test directly.

    returns {"daily": [...], "sleep": [...]}.
    """
    if not records:
        return {"daily": [], "sleep": []}

    by_day = _bucket_by_day(records)
    # _summarize_day returns None for a day that only holds leaked cross-midnight
    # nightly samples — filtering those out kills the phantom pre-midnight row.
    daily = [
        s for s in (_summarize_day(date, recs) for date, recs in sorted(by_day.items()))
        if s is not None
    ]

    sleep = _build_sleep_sessions(records)

    # folding each sleep session back onto its day's summary so sleep_min etc. live
    # in the daily row too. if a day has multiple sessions we sum the durations and
    # take the dominant (longest) session's efficiency/latency.
    by_date_summary = {s["date"]: s for s in daily}
    sessions_by_date: dict[str, list[dict]] = defaultdict(list)
    for sess in sleep:
        sessions_by_date[sess["date"]].append(sess)

    for date, sess_list in sessions_by_date.items():
        summary = by_date_summary.get(date)
        if summary is None:
            # a sleep session whose day had no daytime records — synthesize a row so
            # the sleep data still surfaces. keeping the non-sleep fields None.
            summary = {
                "date": date,
                "resting_hr": None, "hr_min": None, "hr_max": None,
                "hr_avg_day": None, "hrv_rmssd": None, "spo2_avg": None,
                "resp_rate": None, "temp_mean_c": None,
                "sleep_min": None, "sleep_efficiency": None,
                "sleep_latency_min": None, "stage_breakdown_json": None,
                "steps": 0, "met_high_min": 0.0,
            }
            daily.append(summary)
            by_date_summary[date] = summary

        # rolling up the asleep-derived nightly metrics from the WHOLE night (every
        # sample inside each session window), attributed here to the session's end
        # date — so a cross-midnight night reads as one night instead of splitting.
        night_hr: list[float] = []
        night_resting: list[float] = []
        night_hrv: list[float] = []
        night_spo2: list[float] = []
        night_resp: list[float] = []
        night_temp: list[float] = []
        for s in sess_list:
            nm = _nightly_metrics(records, s["start_ms"], s["end_ms"])
            night_hr.extend(nm["asleep_hr"])
            if nm["resting_hr"] is not None:
                night_resting.append(nm["resting_hr"])
            if nm["hrv_rmssd"] is not None:
                night_hrv.append(nm["hrv_rmssd"])
            if nm["spo2_avg"] is not None:
                night_spo2.append(nm["spo2_avg"])
            if nm["resp_rate"] is not None:
                night_resp.append(nm["resp_rate"])
            if nm["temp_mean_c"] is not None:
                night_temp.append(nm["temp_mean_c"])

        # resting_hr = ~5th percentile across the night's pooled asleep heart rate
        # (recomputed on the pooled samples rather than averaging per-session
        # percentiles, which would be wrong for multiple sessions).
        summary["resting_hr"] = _percentile(night_hr, 5.0)
        summary["hrv_rmssd"] = _mean(night_hrv)
        summary["spo2_avg"] = _mean(night_spo2)
        summary["resp_rate"] = _mean(night_resp)
        summary["temp_mean_c"] = _mean(night_temp)

        # widening the day's hr extremes with the night's asleep lows/highs so
        # hr_min/hr_max span both the daytime and the night attributed here.
        if night_hr:
            lo = min(night_hr)
            hi = max(night_hr)
            summary["hr_min"] = lo if summary["hr_min"] is None else min(summary["hr_min"], lo)
            summary["hr_max"] = hi if summary["hr_max"] is None else max(summary["hr_max"], hi)

        total_sleep = sum(s["total_min"] for s in sess_list)
        deep = sum(s["deep_min"] for s in sess_list)
        rem = sum(s["rem_min"] for s in sess_list)
        light = sum(s["light_min"] for s in sess_list)
        awake = sum(s["awake_min"] for s in sess_list)
        dominant = max(sess_list, key=lambda s: s["total_min"])

        summary["sleep_min"] = total_sleep
        summary["sleep_efficiency"] = dominant["efficiency"]
        summary["sleep_latency_min"] = dominant["latency_min"]
        summary["stage_breakdown_json"] = json.dumps({
            "deep_min": deep, "rem_min": rem,
            "light_min": light, "awake_min": awake,
        })

    daily.sort(key=lambda s: s["date"])
    return {"daily": daily, "sleep": sleep}


def rebuild_all(conn) -> dict:
    """recomputing all derived tables from the raw firehose.

    pulling every record via store.get_all_records, summarizing, then upserting
    each daily summary + sleep session. wrapped defensively so a single bad
    upsert doesn't abort the whole rebuild.
    """
    # importing inside the function to dodge any import-cycle with store
    from vitaldeck.db import store

    try:
        records = store.get_all_records(conn)
    except Exception as exc:  # noqa: BLE001 — rebuild must never crash the caller
        print(f"rebuild_all: failed to read records: {exc}")
        return {"days": 0, "sleep_sessions": 0}

    result = summarize_records(records)

    days = 0
    for summary in result["daily"]:
        try:
            store.upsert_daily_summary(conn, summary)
            days += 1
        except Exception as exc:  # noqa: BLE001
            print(f"rebuild_all: daily upsert failed for {summary.get('date')}: {exc}")

    sessions = 0
    for sess in result["sleep"]:
        try:
            store.upsert_sleep_session(conn, sess)
            sessions += 1
        except Exception as exc:  # noqa: BLE001
            print(f"rebuild_all: sleep upsert failed: {exc}")

    return {"days": days, "sleep_sessions": sessions}
