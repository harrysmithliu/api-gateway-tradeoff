from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from redis.asyncio import Redis

from app.core.redis import get_redis_client
from app.schemas.logs import LogListResponse
from app.services.log_service import LogService

router = APIRouter(prefix="/logs", tags=["logs"])


async def get_log_service(redis_client: Redis = Depends(get_redis_client)) -> LogService:
    return LogService(redis_client=redis_client)


@router.get("", response_model=LogListResponse)
async def list_logs(
    cursor: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=500),
    rejected_only: bool = Query(default=False),
    run_id: UUID | None = Query(default=None),
    service: LogService = Depends(get_log_service),
) -> LogListResponse:
    items, next_cursor = await service.list_logs(
        cursor=cursor,
        limit=limit,
        run_id=run_id,
        rejected_only=rejected_only,
    )
    return LogListResponse(
        items=items,
        next_cursor=next_cursor,
        limit=limit,
        run_id=run_id,
    )
