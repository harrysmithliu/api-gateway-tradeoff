from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db_session
from app.schemas.run import RunCompleteRequest, RunCreateRequest, RunResponse
from app.services.run_service import RunService

router = APIRouter(prefix="/runs", tags=["runs"])


async def get_run_service(db: AsyncSession = Depends(get_db_session)) -> RunService:
    return RunService(db)


@router.post("", response_model=RunResponse, status_code=status.HTTP_201_CREATED)
async def create_run(
    payload: RunCreateRequest,
    service: RunService = Depends(get_run_service),
) -> RunResponse:
    run = await service.create_run(payload)
    return RunResponse.model_validate(run)


@router.post("/{run_id}/complete", response_model=RunResponse)
async def complete_run(
    run_id: UUID,
    payload: RunCompleteRequest,
    service: RunService = Depends(get_run_service),
) -> RunResponse:
    run = await service.complete_run(run_id, payload)
    return RunResponse.model_validate(run)


@router.get("", response_model=list[RunResponse])
async def list_runs(service: RunService = Depends(get_run_service)) -> list[RunResponse]:
    runs = await service.list_runs()
    return [RunResponse.model_validate(run) for run in runs]
