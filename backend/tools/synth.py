"""synthetic Oura-style record generator — a faithful stand-in for open_ring's
decoded output so the whole backend (store -> summarize -> metrics -> api) can be
exercised without a real ring capture.

everything here is deterministic: seeded python `random`, and a FIXED end-of-window
timestamp constant rather than wall-clock time, so tests reproduce byte-for-byte.

the emitted dicts are PRE-normalize raw envelopes — exactly the shape
`vitaldeck.records.normalize()` expects on the way in: keys t_event_ms, type,
sess, ctr, data. summarize.py keys off the canonical `type` strings in CONTRACTS
§1, so the type names and `data` fields here MUST match that table exactly.
"""
from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

# --- the FIXED window anchor -------------------------------------------------
# end_ms defaults to this constant, NEVER time.time(). it's a 2026 epoch-ms
# literal so generated days land in a stable, recent-looking window and tests
# stay reproducible across machines and runs.
# corresponds to 2026-06-15T12:00:00Z.
DEFAULT_END_MS = 1781870400000

# milliseconds per day — handy throughout for stepping through the window.
MS_PER_DAY = 86_400_000
MS_PER_HOUR = 3_600_000
MS_PER_MIN = 60_000

# which nights get sabotaged. spreading them across the window (not all at the
# front) so the readiness dip shows up at different points in the trend line.
# these are "days-ago" indices counting back from the most recent generated day.
BAD_NIGHT_OFFSETS = (1, 4, 9)


def _local_day_start_utc_ms(day_anchor_ms: int) -> int:
    """returning the UTC epoch-ms of local midnight for the day containing
    `day_anchor_ms`.

    the rest of the backend groups records into local days using
    config.LOCAL_UTC_OFFSET_HOURS; we mirror that math here so a night we
    intend as "one night" actually falls inside one local day's sleep window.
    importing config lazily keeps this module import-light and test-friendly.
    """
    try:
        from vitaldeck import config  # noqa: WPS433 — lazy on purpose

        offset_ms = int(config.LOCAL_UTC_OFFSET_HOURS * MS_PER_HOUR)
    except Exception:
        # falling back to the project default (-5h) if config can't be imported
        offset_ms = int(-5 * MS_PER_HOUR)

    local_ms = day_anchor_ms + offset_ms
    local_midnight = (local_ms // MS_PER_DAY) * MS_PER_DAY
    return local_midnight - offset_ms


def _env(t_event_ms: int, rtype: str, sess: int, ctr: int, data: dict[str, Any]) -> dict[str, Any]:
    """building one raw envelope dict in the pre-normalize shape.

    we keep sess/ctr explicit so the dedupe key (t_event_ms, type, sess) behaves
    — a night's worth of one type shares a session id but climbs ctr.
    """
    return {
        "t_event_ms": int(t_event_ms),
        "type": rtype,
        "sess": int(sess),
        "ctr": int(ctr),
        "data": data,
    }


def _gen_sleep_window(
    rnd: random.Random,
    night_start_ms: int,
    sess: int,
    bad: bool,
    out: list[dict[str, Any]],
) -> tuple[int, int]:
    """laying down one night: a sleep_stage hypnogram plus the nightly samples
    (asleep heart_rate, hrv, spo2, resp, skin_temp, sparse ibi) riding on top.

    returns (sleep_start_ms, sleep_end_ms) so the caller knows the asleep span.
    on a `bad` night we suppress hrv ~25%, lift resting hr ~8%, and bump skin
    temp +0.5C so downstream readiness visibly dips.
    """
    # a realistic-ish hypnogram: ~7-8h with a believable stage cadence. we build
    # it as a run-length list of (stage, minutes) then emit one record per run.
    total_min = rnd.randint(420, 500)  # 7h to ~8.3h in bed
    elapsed = 0
    stages: list[tuple[str, int]] = []

    # a brief settling-in awake spell drives sleep latency in summarize
    latency = rnd.randint(4, 18)
    stages.append(("awake", latency))
    elapsed += latency

    # cycling light/deep/rem with the usual front-loaded deep, back-loaded rem.
    # keeping it simple and seeded; summarize only needs contiguous stage runs.
    cycle = 0
    while elapsed < total_min:
        remaining = total_min - elapsed
        # rough ~90-min cycles
        deep_w = max(8, 28 - cycle * 6)
        rem_w = min(40, 10 + cycle * 7)
        for stage, base in (("light", 35), ("deep", deep_w), ("light", 20), ("rem", rem_w)):
            if elapsed >= total_min:
                break
            dur = min(rnd.randint(max(5, base - 8), base + 8), total_min - elapsed)
            if dur <= 0:
                continue
            # an occasional micro-awakening mid-night
            if rnd.random() < 0.10 and stage == "light":
                wk = rnd.randint(1, 5)
                stages.append(("awake", wk))
                elapsed += wk
                if elapsed >= total_min:
                    break
                dur = min(dur, total_min - elapsed)
                if dur <= 0:
                    continue
            stages.append((stage, dur))
            elapsed += dur
        cycle += 1
        if remaining == total_min - elapsed:  # safety: no progress, bail
            break

    # emitting the hypnogram as sleep_stage records, walking the clock forward.
    sleep_start_ms = night_start_ms
    t = sleep_start_ms
    ctr = 0
    for stage, minutes in stages:
        out.append(
            _env(t, "sleep_stage", sess, ctr, {"stage": stage, "duration_s": minutes * 60})
        )
        ctr += 1
        t += minutes * MS_PER_MIN
    sleep_end_ms = t

    # nightly continuous samples ride across the asleep span (skip the wake-only
    # tail). resting-hr / hrv / temp shifts are what readiness reads.
    rhr_base = rnd.uniform(50, 56)
    hrv_base = rnd.uniform(45, 70)
    temp_base = rnd.uniform(35.6, 36.4)
    if bad:
        rhr_base *= 1.08          # elevated resting hr
        hrv_base *= 0.75          # suppressed hrv (~25% down)
        temp_base += 0.5          # warmer skin temp

    # heart_rate every ~5 min while asleep, dipping below the daytime baseline
    hr_ctr = 0
    step = 5 * MS_PER_MIN
    tt = sleep_start_ms
    while tt < sleep_end_ms:
        # a gentle nocturnal trough — lowest in the deep middle of the night
        phase = (tt - sleep_start_ms) / max(1, (sleep_end_ms - sleep_start_ms))
        trough = -3.0 * (1 - abs(phase - 0.5) * 2)  # dips toward mid-night
        bpm = int(round(rhr_base + trough + rnd.uniform(-2.0, 2.5)))
        out.append(_env(tt, "heart_rate", sess, hr_ctr, {"bpm": max(38, bpm), "asleep": True}))
        hr_ctr += 1
        tt += step

    # hrv every ~5 min while asleep (rmssd in ms)
    hrv_ctr = 0
    tt = sleep_start_ms
    while tt < sleep_end_ms:
        rmssd = round(hrv_base + rnd.uniform(-8.0, 8.0), 1)
        out.append(_env(tt, "hrv", sess, hrv_ctr, {"rmssd_ms": max(8.0, rmssd)}))
        hrv_ctr += 1
        tt += step

    # spo2 nightly (%), tight band
    spo2_ctr = 0
    tt = sleep_start_ms
    while tt < sleep_end_ms:
        pct = round(rnd.uniform(95.0, 99.0) - (1.2 if bad else 0.0), 1)
        out.append(_env(tt, "spo2", sess, spo2_ctr, {"spo2_pct": min(100.0, pct)}))
        spo2_ctr += 1
        tt += 10 * MS_PER_MIN

    # respiratory rate nightly (rpm)
    resp_ctr = 0
    tt = sleep_start_ms
    while tt < sleep_end_ms:
        rpm = round(rnd.uniform(13.0, 17.0) + (0.8 if bad else 0.0), 1)
        out.append(_env(tt, "resp", sess, resp_ctr, {"rpm": rpm}))
        resp_ctr += 1
        tt += 10 * MS_PER_MIN

    # skin temp every ~10 min (deg C)
    temp_ctr = 0
    tt = sleep_start_ms
    while tt < sleep_end_ms:
        temp_c = round(temp_base + rnd.uniform(-0.15, 0.15), 2)
        out.append(_env(tt, "skin_temp", sess, temp_ctr, {"temp_c": temp_c}))
        temp_ctr += 1
        tt += 10 * MS_PER_MIN

    # a sparse handful of ibi samples (the real thing is high-volume; we just
    # need the type present and plausible — ~60000/bpm ms between beats)
    ibi_ctr = 0
    tt = sleep_start_ms
    while tt < sleep_end_ms:
        ibi = int(round(60000.0 / max(40.0, rhr_base) + rnd.uniform(-40, 40)))
        out.append(_env(tt, "ibi", sess, ibi_ctr, {"ibi_ms": max(300, ibi)}))
        ibi_ctr += 1
        tt += 30 * MS_PER_MIN  # truly sparse

    return sleep_start_ms, sleep_end_ms


def _gen_daytime(
    rnd: random.Random,
    day_wake_ms: int,
    day_end_ms: int,
    sess: int,
    out: list[dict[str, Any]],
) -> None:
    """filling the waking hours: daytime heart_rate, accel activity bursts,
    activity_met bins, and an occasional battery reading."""
    # daytime heart_rate every ~5 min, higher than the asleep trough
    hr_base = rnd.uniform(64, 76)
    hr_ctr = 0
    tt = day_wake_ms
    while tt < day_end_ms:
        # afternoon-ish activity bump
        bpm = int(round(hr_base + rnd.uniform(-6, 14)))
        out.append(_env(tt, "heart_rate", sess, hr_ctr, {"bpm": max(45, bpm), "asleep": False}))
        hr_ctr += 1
        tt += 5 * MS_PER_MIN

    # accel activity magnitude every ~10 min — mostly low with a few bursts
    acm_ctr = 0
    tt = day_wake_ms
    while tt < day_end_ms:
        if rnd.random() < 0.18:
            acm = round(rnd.uniform(0.6, 2.5), 3)  # a movement burst
        else:
            acm = round(rnd.uniform(0.0, 0.4), 3)  # idle-ish
        out.append(_env(tt, "accel", sess, acm_ctr, {"acm": acm}))
        acm_ctr += 1
        tt += 10 * MS_PER_MIN

    # activity_met bins every ~15 min — 1.0 at rest, spikes when active
    met_ctr = 0
    tt = day_wake_ms
    while tt < day_end_ms:
        if rnd.random() < 0.15:
            met = round(rnd.uniform(3.5, 8.0), 1)  # a workout / brisk walk
        else:
            met = round(rnd.uniform(1.0, 2.0), 1)  # daily puttering
        out.append(_env(tt, "activity_met", sess, met_ctr, {"met": met}))
        met_ctr += 1
        tt += 15 * MS_PER_MIN

    # an occasional battery reading — once or twice across the day
    if rnd.random() < 0.6:
        batt_t = day_wake_ms + rnd.randint(0, max(1, day_end_ms - day_wake_ms))
        out.append(_env(batt_t, "battery", sess, 0, {"pct": rnd.randint(20, 100)}))


def generate(days: int = 30, seed: int = 42, end_ms: int | None = None) -> list[dict[str, Any]]:
    """generating `days` of synthetic raw envelopes ending at `end_ms`.

    output spans every canonical type in CONTRACTS §1 with circadian structure:
    a nightly sleep window (hypnogram + asleep hr trough + hrv/spo2/resp/temp/ibi
    samples) and a daytime block (waking hr + accel + activity_met + occasional
    battery). a couple of injected bad nights tank hrv / lift rhr / warm temp so
    readiness visibly dips downstream.

    deterministic: seeded `random.Random(seed)`; end_ms defaults to the fixed
    DEFAULT_END_MS constant, never wall-clock.
    """
    if end_ms is None:
        end_ms = DEFAULT_END_MS
    try:
        days = int(days)
    except (TypeError, ValueError):
        days = 30
    if days <= 0:
        return []

    rnd = random.Random(seed)
    out: list[dict[str, Any]] = []

    # the bad-night set, resolved to absolute day indices within [0, days).
    # index 0 == the most recent generated day, counting back from end_ms.
    bad_days = {off for off in BAD_NIGHT_OFFSETS if 0 <= off < days}
    # if the window is too short to hit our preferred offsets, sabotage the
    # most recent night so the "bad nights exist" guarantee always holds.
    if not bad_days and days > 0:
        bad_days = {0}

    for back in range(days):
        # `back` counts days backward from the day containing end_ms
        day_anchor = end_ms - back * MS_PER_DAY
        local_midnight = _local_day_start_utc_ms(day_anchor)

        # this day's records share a session id; using the local-day index so
        # it's stable and distinct per day.
        sess = (local_midnight // MS_PER_DAY) % 100000

        # the night belonging to this local day: sleep onset late the prior
        # evening (~23:00 local) running into the early morning. anchoring it so
        # the session's end_ms (its "date") lands on THIS local day.
        onset_offset = (23 * MS_PER_HOUR) - MS_PER_DAY  # 11pm of the previous local night
        night_start = local_midnight + onset_offset + rnd.randint(-30, 30) * MS_PER_MIN

        is_bad = back in bad_days
        _, sleep_end = _gen_sleep_window(rnd, night_start, sess, is_bad, out)

        # daytime runs from a bit after waking until late evening of this local
        # day, but never past end_ms for the most recent day.
        day_wake = sleep_end + rnd.randint(10, 40) * MS_PER_MIN
        day_end = local_midnight + 22 * MS_PER_HOUR
        if back == 0:
            day_end = min(day_end, end_ms)
        if day_wake < day_end:
            _gen_daytime(rnd, day_wake, day_end, sess, out)

    # sorting chronologically so the JSONL reads like a real capture stream
    out.sort(key=lambda r: (r["t_event_ms"], r["type"]))
    return out


def write_jsonl(path: str | Path, days: int = 30, seed: int = 42) -> int:
    """writing generated records to `path` as JSONL (one envelope per line).

    returns the count written. wrapped defensively — a filesystem hiccup logs
    and returns 0 rather than crashing a caller.
    """
    records = generate(days=days, seed=seed)
    try:
        p = Path(path)
        if p.parent and not p.parent.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("w", encoding="utf-8") as fh:
            for rec in records:
                fh.write(json.dumps(rec) + "\n")
    except OSError as exc:
        # non-crashing fallback per the defensive-coding rule
        print(f"synth.write_jsonl: failed writing {path}: {exc}")
        return 0
    return len(records)
