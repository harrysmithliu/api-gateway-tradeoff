from __future__ import annotations

from pydantic import BaseModel


class MetricsSummaryResponse(BaseModel):
    total: int
    allowed: int
    rejected: int
    accept_rate: float
    reject_rate: float
    qps: float
    p50: float
    p95: float
    p99: float
    peak_qps: float


class TimeseriesPoint(BaseModel):
    ts: int
    qps: float
    allowed: int
    rejected: int
    reject_rate: float
    p99_ms: float
    peak_delta: float
