from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db_session
from app.core.redis import get_redis_client
from app.schemas.simulate import (
    SimulateBurstPayload,
    SimulateBurstResponse,
    SimulateDecisionResponse,
    SimulateRequestPayload,
)
from app.services.simulate_service import SimulateService

router = APIRouter(prefix="/simulate", tags=["simulate"])


async def get_simulate_service(
    db: AsyncSession = Depends(get_db_session),
    redis_client: Redis = Depends(get_redis_client),
) -> SimulateService:
    return SimulateService(db_session=db, redis_client=redis_client)


@router.post("/request", response_model=SimulateDecisionResponse)
async def simulate_request(
    payload: SimulateRequestPayload,
    service: SimulateService = Depends(get_simulate_service),
) -> JSONResponse:
    result = await service.simulate_one(payload)
    status_code = 200 if result.allowed else 429
    return JSONResponse(status_code=status_code, content=result.model_dump(mode="json"))


@router.post("/burst", response_model=SimulateBurstResponse)
async def simulate_burst(
    payload: SimulateBurstPayload,
    service: SimulateService = Depends(get_simulate_service),
) -> SimulateBurstResponse:
    return await service.simulate_burst(payload)
