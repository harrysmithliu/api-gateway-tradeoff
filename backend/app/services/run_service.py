from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.policy import RateLimitPolicy
from app.models.run import ExperimentRun
from app.schemas.run import RunCompleteRequest, RunCreateRequest


class RunService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create_run(self, payload: RunCreateRequest) -> ExperimentRun:
        policy = await self.session.get(RateLimitPolicy, payload.policy_id)
        if policy is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Policy not found.",
            )

        run = ExperimentRun(
            name=payload.name,
            policy_id=payload.policy_id,
            scenario_json=payload.scenario_json,
            started_at=datetime.now(timezone.utc),
            status="running",
        )
        self.session.add(run)
        await self.session.commit()
        await self.session.refresh(run)
        return run

    async def complete_run(self, run_id: UUID, payload: RunCompleteRequest) -> ExperimentRun:
        run = await self.session.get(ExperimentRun, run_id)
        if run is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Run not found.",
            )

        if run.status != "running":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Run is already finalized.",
            )

        run.status = payload.status
        run.ended_at = datetime.now(timezone.utc)
        await self.session.commit()
        await self.session.refresh(run)
        return run

    async def list_runs(self) -> list[ExperimentRun]:
        result = await self.session.execute(
            select(ExperimentRun).order_by(ExperimentRun.started_at.desc())
        )
        return list(result.scalars().all())
