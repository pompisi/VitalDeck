"""the read-only http surface the expo app consumes (CONTRACTS §6).

every endpoint opens a fresh store.connect() per request — sqlite connections
aren't safe to share across FastAPI's threadpool, so connecting per request keeps
us out of "SQLite objects created in a thread can only be used in that same
thread" territory. the app object MUST be named `app` so
`uvicorn vitaldeck.api.main:app` works.
"""
from __future__ import annotations

import sqlite3
from contextlib import asynccontextmanager, contextmanager
from typing import Any, Iterator, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from vitaldeck import config
from vitaldeck import pipeline
from vitaldeck import summarize
from vitaldeck.db import store
from vitaldeck.metrics import baselines as baselines_mod
from vitaldeck.metrics import readiness as readiness_mod

from .models import (
    DeleteResponse,
    HealthResponse,
    MetricsResponse,
    SleepResponse,
    SummaryResponse,
    SyncResponse,
    Tag,
    TagCreate,
    TagsResponse,
    TrendsResponse,
)

# metrics the /trends endpoint understands. readiness_custom is special-cased to
# the metrics table; everything else maps straight onto a daily_summaries column.
SUMMARY_TREND_COLUMNS = {
    "hrv_rmssd": "hrv_rmssd",
    "resting_hr": "resting_hr",
    "temp_mean_c": "temp_mean_c",
    "sleep_min": "sleep_min",
    "spo2_avg": "spo2_avg",
}
# which baseline series (if any) backs each trend metric, for the band overlay.
TREND_BASELINE_KEY = {
    "hrv_rmssd": "hrv_rmssd",
    "resting_hr": "resting_hr",
    "temp_mean_c": "temp_mean_c",
}
VALID_TREND_METRICS = set(SUMMARY_TREND_COLUMNS) | {"readiness_custom"}

@asynccontextmanager
async def _lifespan(_app: "FastAPI"):
    # start the twice-daily auto-sync when a real source (oura token / adb) is
    # configured; the scheduler itself no-ops in synthetic/dev. lazy import keeps
    # the module graph clean. wrapped so a scheduler hiccup never blocks the api.
    try:
        from vitaldeck import scheduler

        scheduler.start()
    except Exception as exc:
        print(f"[api] scheduler start failed: {exc}")
    yield
    try:
        from vitaldeck import scheduler

        scheduler.shutdown()
    except Exception as exc:
        print(f"[api] scheduler shutdown failed: {exc}")


app = FastAPI(title="VitalDeck", version="0.1.0", lifespan=_lifespan)

# wide-open CORS — this only ever runs on a personal LAN / Tailscale net, so the
# convenience of any-origin beats locking it down here.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@contextmanager
def _conn() -> Iterator[sqlite3.Connection]:
    """opening a fresh connection per request and always closing it. connect()
    also runs init_db, so a brand-new db file is fine."""
    conn = store.connect()
    try:
        yield conn
    finally:
        try:
            conn.close()
        except Exception as exc:  # pragma: no cover - close shouldn't really fail
            print(f"[api] connection close failed: {exc}")


def _latest_event(conn: sqlite3.Connection) -> Optional[int]:
    """best-effort "data as of" — never let a read here crash an endpoint."""
    try:
        return store.latest_event_ms(conn)
    except Exception as exc:
        print(f"[api] latest_event_ms failed: {exc}")
        return None


def _data_as_of(conn: sqlite3.Connection) -> Optional[int]:
    """'data as of' — newest raw event, or (the oura path, which has no
    raw_records) the newest sleep session end, so the STATUS header reads right
    no matter which ingest source ran."""
    ev = _latest_event(conn)
    if ev is not None:
        return ev
    try:
        sessions = store.get_sleep_sessions(conn, 14)
        ends = [int(s["end_ms"]) for s in sessions if s.get("end_ms") is not None]
        return max(ends) if ends else None
    except Exception as exc:
        print(f"[api] data_as_of sleep fallback failed: {exc}")
        return None


# ---------------------------------------------------------------------------
# health
# ---------------------------------------------------------------------------
@app.get("/health", response_model=HealthResponse)
def health() -> dict[str, Any]:
    """cheap liveness probe — confirms the db opens and reports the newest event."""
    db_ok = False
    data_as_of: Optional[int] = None
    try:
        with _conn() as conn:
            db_ok = True
            data_as_of = _data_as_of(conn)
    except Exception as exc:
        print(f"[api] /health db open failed: {exc}")
        db_ok = False
    return {"status": "ok", "db": db_ok, "data_as_of": data_as_of}


# ---------------------------------------------------------------------------
# summaries
# ---------------------------------------------------------------------------
def _summary_payload(conn: sqlite3.Connection, summary: dict[str, Any]) -> dict[str, Any]:
    """packaging a daily_summary dict together with its readiness metric row."""
    date = summary.get("date")
    metric: Optional[dict[str, Any]] = None
    if date:
        try:
            metric = store.get_metric(conn, date)
        except Exception as exc:
            print(f"[api] get_metric({date}) failed: {exc}")
            metric = None
    return {
        "date": date,
        "summary": summary,
        "metric": metric,
        "data_as_of": _data_as_of(conn),
    }


@app.get("/summary/today", response_model=SummaryResponse)
def summary_today() -> dict[str, Any]:
    """returning the most recent stored day + its custom-readiness metric."""
    with _conn() as conn:
        try:
            summary = store.get_latest_daily_summary(conn)
        except Exception as exc:
            print(f"[api] get_latest_daily_summary failed: {exc}")
            summary = None
        if not summary:
            raise HTTPException(status_code=404, detail="no daily summaries yet")
        return _summary_payload(conn, summary)


@app.get("/summary/{date}", response_model=SummaryResponse)
def summary_for_date(date: str) -> dict[str, Any]:
    """same shape as /summary/today but for an explicit YYYY-MM-DD."""
    with _conn() as conn:
        try:
            summary = store.get_daily_summary(conn, date)
        except Exception as exc:
            print(f"[api] get_daily_summary({date}) failed: {exc}")
            summary = None
        if not summary:
            raise HTTPException(status_code=404, detail=f"no summary for {date}")
        return _summary_payload(conn, summary)


# ---------------------------------------------------------------------------
# trends
# ---------------------------------------------------------------------------
@app.get("/trends", response_model=TrendsResponse)
def trends(metric: str = "hrv_rmssd", days: int = 30) -> dict[str, Any]:
    """one metric over time + its 14/30-day baseline for the chart band.

    readiness_custom pulls from the metrics table; the rest pull the matching
    daily_summaries column. baselines come from metrics.baselines so the band
    matches what readiness actually scored against.
    """
    if metric not in VALID_TREND_METRICS:
        raise HTTPException(
            status_code=400,
            detail=f"unknown metric {metric!r}; expected one of {sorted(VALID_TREND_METRICS)}",
        )

    days = max(1, min(days, 365))
    points: list[dict[str, Any]] = []
    baseline_14: Optional[float] = None
    baseline_30: Optional[float] = None

    with _conn() as conn:
        if metric == "readiness_custom":
            # readiness lives in its own table; no rolling baseline for the score
            try:
                rows = store.get_metrics(conn, days)
            except Exception as exc:
                print(f"[api] get_metrics failed: {exc}")
                rows = []
            for row in rows:
                points.append(
                    {"date": row.get("date"), "value": _as_float(row.get("readiness_custom"))}
                )
        else:
            column = SUMMARY_TREND_COLUMNS[metric]
            try:
                summaries = store.get_daily_summaries(conn, days)
            except Exception as exc:
                print(f"[api] get_daily_summaries failed: {exc}")
                summaries = []
            for row in summaries:
                points.append({"date": row.get("date"), "value": _as_float(row.get(column))})

            # baselines only exist for the three the model tracks
            baseline_field = TREND_BASELINE_KEY.get(metric)
            if baseline_field:
                try:
                    bl = baselines_mod.compute_baselines(summaries)
                    series = bl.get(baseline_field, {}) if isinstance(bl, dict) else {}
                    baseline_14 = _as_float(series.get("14"))
                    baseline_30 = _as_float(series.get("30"))
                except Exception as exc:
                    print(f"[api] compute_baselines failed: {exc}")

    return {
        "metric": metric,
        "points": points,
        "baseline_14": baseline_14,
        "baseline_30": baseline_30,
    }


# ---------------------------------------------------------------------------
# sleep
# ---------------------------------------------------------------------------
@app.get("/sleep", response_model=SleepResponse)
def sleep(days: int = 30) -> dict[str, Any]:
    """recent sleep sessions, each already a plain dict from the store."""
    days = max(1, min(days, 365))
    with _conn() as conn:
        try:
            sessions = store.get_sleep_sessions(conn, days)
        except Exception as exc:
            print(f"[api] get_sleep_sessions failed: {exc}")
            sessions = []
    return {"sessions": sessions}


# ---------------------------------------------------------------------------
# metrics
# ---------------------------------------------------------------------------
@app.get("/metrics", response_model=MetricsResponse)
def metrics_endpoint(days: int = 30) -> dict[str, Any]:
    """readiness score + per-component breakdown over the recent window."""
    days = max(1, min(days, 365))
    points: list[dict[str, Any]] = []
    with _conn() as conn:
        try:
            rows = store.get_metrics(conn, days)
        except Exception as exc:
            print(f"[api] get_metrics failed: {exc}")
            rows = []
        for row in rows:
            components = row.get("components")
            if not isinstance(components, dict):
                components = {}
            points.append(
                {
                    "date": row.get("date"),
                    "readiness_custom": _as_float(row.get("readiness_custom")),
                    "components": components,
                }
            )
    return {"points": points}


# ---------------------------------------------------------------------------
# tags
# ---------------------------------------------------------------------------
@app.get("/tags", response_model=TagsResponse)
def list_tags(days: Optional[int] = None) -> dict[str, Any]:
    """listing manual context tags (caffeine, gym, alcohol…)."""
    # clamping days the same way the other windowed endpoints do — a negative
    # value used to slip through and silently return [].
    days = None if days is None else max(0, min(days, 365))
    with _conn() as conn:
        try:
            tags = store.list_tags(conn, days)
        except Exception as exc:
            print(f"[api] list_tags failed: {exc}")
            tags = []
    return {"tags": tags}


@app.post("/tags", response_model=Tag)
def create_tag(body: TagCreate) -> dict[str, Any]:
    """recording a new tag and handing back the created row."""
    with _conn() as conn:
        try:
            row = store.add_tag(conn, body.ts_ms, body.label, body.note)
        except Exception as exc:
            print(f"[api] add_tag failed: {exc}")
            raise HTTPException(status_code=500, detail="failed to create tag") from exc
    # store.add_tag swallows sqlite errors and hands back a null-id dict, so a
    # failed insert would otherwise 200 with id:null — treating that as a 500.
    if not row or row.get("id") is None:
        raise HTTPException(status_code=500, detail="failed to create tag")
    return row


@app.delete("/tags/{tag_id}", response_model=DeleteResponse)
def remove_tag(tag_id: int) -> dict[str, Any]:
    """deleting a tag by id; deleted=false when nothing matched."""
    with _conn() as conn:
        try:
            ok = store.delete_tag(conn, tag_id)
        except Exception as exc:
            print(f"[api] delete_tag failed: {exc}")
            ok = False
    return {"deleted": bool(ok)}


# ---------------------------------------------------------------------------
# sync — the one write path
# ---------------------------------------------------------------------------
@app.post("/sync", response_model=SyncResponse)
def sync() -> dict[str, Any]:
    """running the pipeline. with no adb target configured we're in dev, so we
    fabricate one extra synthetic day and run it through the full pipeline;
    otherwise we pull + decode a real capture."""
    return run_sync()


def run_sync() -> dict[str, Any]:
    """the shared sync routine, callable from the endpoint and the scheduler.

    synthetic mode (no ADB_TARGET): generate one fresh day after the latest
    stored event, ingest, rebuild summaries, recompute recent metrics.
    live mode: pull the snoop log + decode it, then the same downstream rebuild.
    """
    if config.OURA_TOKEN:
        return _sync_oura()
    if config.ADB_TARGET:
        return _sync_live()
    return _sync_synthetic()


def _sync_synthetic() -> dict[str, Any]:
    """dev fallback — append a single synthetic day and rebuild derived tables."""
    ingested = 0
    deduped = 0
    data_as_of: Optional[int] = None
    try:
        # importing lazily so the api module doesn't hard-depend on tools at import
        from tools import synth

        with _conn() as conn:
            latest = _latest_event(conn)
            # generating one day that starts after whatever we already have; if the
            # store is empty, synth falls back to its own fixed end_ms constant.
            day_ms = 24 * 60 * 60 * 1000
            if latest is not None:
                end_ms = latest + day_ms
                raw = synth.generate(days=1, end_ms=end_ms)
            else:
                raw = synth.generate(days=1)

            sync_run_id = None
            try:
                sync_run_id = store.start_sync_run(conn, "synthetic")
            except Exception as exc:
                print(f"[api] start_sync_run failed: {exc}")

            result = store.ingest_records(conn, raw, sync_run_id)
            ingested = int(result.get("ingested", 0))
            deduped = int(result.get("deduped", 0))

            if sync_run_id is not None:
                try:
                    store.finish_sync_run(conn, sync_run_id, "ok", ingested, deduped)
                except Exception as exc:
                    print(f"[api] finish_sync_run failed: {exc}")

            _recompute(conn)
            data_as_of = _latest_event(conn)
    except Exception as exc:
        print(f"[api] synthetic sync failed: {exc}")
        return {
            "ok": False,
            "ingested": ingested,
            "deduped": deduped,
            "data_as_of": data_as_of,
            "mode": "synthetic",
            "error": str(exc),
        }
    return {
        "ok": True,
        "ingested": ingested,
        "deduped": deduped,
        "data_as_of": data_as_of,
        "mode": "synthetic",
    }


def _sync_live() -> dict[str, Any]:
    """real pull: bugreport -> btsnoop -> replay -> ingest -> rebuild."""
    ingested = 0
    deduped = 0
    data_as_of: Optional[int] = None
    try:
        from vitaldeck.ingest import decode as decode_mod
        from vitaldeck.ingest import pull_snoop

        capture = pull_snoop.pull_and_extract()
        records = list(decode_mod.decode_capture(capture))

        with _conn() as conn:
            sync_run_id = None
            try:
                sync_run_id = store.start_sync_run(conn, str(capture))
            except Exception as exc:
                print(f"[api] start_sync_run failed: {exc}")

            result = store.ingest_records(conn, records, sync_run_id)
            ingested = int(result.get("ingested", 0))
            deduped = int(result.get("deduped", 0))

            if sync_run_id is not None:
                try:
                    store.finish_sync_run(conn, sync_run_id, "ok", ingested, deduped)
                except Exception as exc:
                    print(f"[api] finish_sync_run failed: {exc}")

            _recompute(conn)
            data_as_of = _latest_event(conn)
    except Exception as exc:
        # a failed pull/decode shouldn't 500 — report ok=false with the note
        print(f"[api] live sync failed: {exc}")
        return {
            "ok": False,
            "ingested": ingested,
            "deduped": deduped,
            "data_as_of": data_as_of,
            "mode": "live",
            "error": str(exc),
        }
    return {
        "ok": True,
        "ingested": ingested,
        "deduped": deduped,
        "data_as_of": data_as_of,
        "mode": "live",
    }


def _sync_oura() -> dict[str, Any]:
    """pull real data from the oura cloud api (token set) — the no-debugging,
    no-snoop-log path. upserts summaries + sleep directly, then scores."""
    ingested = 0
    data_as_of: Optional[int] = None
    try:
        from vitaldeck.ingest import oura_api

        with _conn() as conn:
            sync_run_id = None
            try:
                sync_run_id = store.start_sync_run(conn, "oura-api")
            except Exception as exc:
                print(f"[api] start_sync_run failed: {exc}")

            result = oura_api.ingest_oura(conn, config.OURA_TOKEN, days=30)
            ingested = int(result.get("ingested", 0))

            if sync_run_id is not None:
                try:
                    store.finish_sync_run(conn, sync_run_id, "ok", ingested, 0)
                except Exception as exc:
                    print(f"[api] finish_sync_run failed: {exc}")

            # the oura path upserts daily_summaries itself, so we score WITHOUT a
            # rebuild_all (which would wipe them — raw_records is empty here)
            _score_only(conn)
            data_as_of = _data_as_of(conn)
    except Exception as exc:
        print(f"[api] oura sync failed: {exc}")
        return {
            "ok": False,
            "ingested": ingested,
            "deduped": 0,
            "data_as_of": data_as_of,
            "mode": "oura",
            "error": str(exc),
        }
    return {
        "ok": True,
        "ingested": ingested,
        "deduped": 0,
        "data_as_of": data_as_of,
        "mode": "oura",
    }


def _recompute(conn: sqlite3.Connection) -> None:
    """raw-based paths (synthetic / live snoop / manual zip): delegate to the
    shared pipeline so the CLIs reuse the exact same rebuild+score."""
    pipeline.recompute(conn)


def _score_only(conn: sqlite3.Connection) -> None:
    """oura path: score the upserted daily_summaries without a rebuild."""
    pipeline.score_only(conn)


def _as_float(value: Any) -> Optional[float]:
    """coercing db values to float|None so the json shape stays honest."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
