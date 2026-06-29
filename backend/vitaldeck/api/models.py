"""pydantic response models mirroring the JSON shapes CONTRACTS §6 promises.

these are intentionally loose — summaries/sleep/metric rows are plain dicts the
store hands back, so we lean on `dict`/`Any` rather than re-declaring every
column here (the store + summarize contracts already own those shapes). the
models exist mostly so FastAPI documents the surface and so the response keys
stay stable for the expo client.
"""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    db: bool
    data_as_of: Optional[int] = None


class SummaryResponse(BaseModel):
    date: str
    summary: dict[str, Any]
    metric: Optional[dict[str, Any]] = None
    data_as_of: Optional[int] = None


class TrendPoint(BaseModel):
    date: str
    value: Optional[float] = None


class TrendsResponse(BaseModel):
    metric: str
    points: list[TrendPoint]
    baseline_14: Optional[float] = None
    baseline_30: Optional[float] = None


class SleepResponse(BaseModel):
    sessions: list[dict[str, Any]]


class MetricPoint(BaseModel):
    date: str
    readiness_custom: Optional[float] = None
    components: dict[str, Any] = {}


class MetricsResponse(BaseModel):
    points: list[MetricPoint]


class Tag(BaseModel):
    id: int
    ts_ms: int
    label: str
    note: Optional[str] = None
    created_at: Optional[str] = None


class TagsResponse(BaseModel):
    tags: list[Tag]


class TagCreate(BaseModel):
    # body for POST /tags — note is optional per the contract
    ts_ms: int
    label: str
    note: Optional[str] = None


class DeleteResponse(BaseModel):
    deleted: bool


class SyncResponse(BaseModel):
    ok: bool
    ingested: int = 0
    deduped: int = 0
    data_as_of: Optional[int] = None
    mode: str = "synthetic"
    error: Optional[str] = None
