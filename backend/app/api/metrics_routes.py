from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from redis.asyncio import Redis

from app.core.redis import get_redis_client
from app.schemas.metrics import MetricsSummaryResponse, TimeseriesPoint
from app.services.metrics_service import MetricsService

router = APIRouter(prefix="/metrics", tags=["metrics"])


async def get_metrics_service(redis_client: Redis = Depends(get_redis_client)) -> MetricsService:
    return MetricsService(redis_client)


@router.get("/summary", response_model=MetricsSummaryResponse)
async def metrics_summary(
    window_sec: int = Query(default=60, ge=1, le=3600),
    run_id: UUID | None = Query(default=None),
    service: MetricsService = Depends(get_metrics_service),
) -> MetricsSummaryResponse:
    return await service.get_summary(window_sec=window_sec, run_id=run_id)


@router.get("/timeseries", response_model=list[TimeseriesPoint])
async def metrics_timeseries(
    window_sec: int = Query(default=120, ge=1, le=3600),
    step_sec: int = Query(default=1, ge=1, le=60),
    run_id: UUID | None = Query(default=None),
    service: MetricsService = Depends(get_metrics_service),
) -> list[TimeseriesPoint]:
    return await service.get_timeseries(window_sec=window_sec, step_sec=step_sec, run_id=run_id)
