from __future__ import annotations

import asyncio
import json
import time
import uuid
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.limiters.factory import get_limiter_for_algorithm
from app.models.active_policy import ActivePolicy
from app.models.policy import RateLimitPolicy
from app.models.run import ExperimentRun
from app.schemas.simulate import (
    SimulateBurstPayload,
    SimulateBurstResponse,
    SimulateDecisionResponse,
    SimulateRequestPayload,
)
from app.services.metrics_service import MetricsService

LOG_LIST_MAX_LEN = 5000


class SimulateService:
    def __init__(self, db_session: AsyncSession, redis_client: Redis):
        self.db_session = db_session
        self.redis_client = redis_client
        self.metrics_service = MetricsService(redis_client=redis_client)

    async def simulate_one(self, payload: SimulateRequestPayload) -> SimulateDecisionResponse:
        await self._validate_run_context(payload.run_id)
        policy = await self._resolve_active_policy()
        decision = await self._evaluate_request(
            policy=policy,
            client_id=payload.client_id,
            run_id=payload.run_id,
        )
        await self._append_log(decision)
        await self.metrics_service.record_decision(
            run_id=payload.run_id,
            allowed=decision.allowed,
            latency_ms=decision.latency_ms,
        )
        return decision

    async def simulate_burst(self, payload: SimulateBurstPayload) -> SimulateBurstResponse:
        await self._validate_run_context(payload.run_id)
        policy = await self._resolve_active_policy()

        decisions: list[SimulateDecisionResponse] = []
        for index in range(payload.total_requests):
            client_id = payload.client_id
            if payload.client_id_mode == "rotating":
                bucket = index % payload.rotate_pool_size
                client_id = f"{payload.client_id}-{bucket}"

            decision = await self._evaluate_request(
                policy=policy,
                client_id=client_id,
                run_id=payload.run_id,
            )
            decisions.append(decision)
            await self._append_log(decision)
            await self.metrics_service.record_decision(
                run_id=payload.run_id,
                allowed=decision.allowed,
                latency_ms=decision.latency_ms,
            )

            if payload.interval_ms > 0 and index < payload.total_requests - 1:
                await asyncio.sleep(payload.interval_ms / 1000)

        allowed_count = sum(1 for item in decisions if item.allowed)
        rejected_count = payload.total_requests - allowed_count
        return SimulateBurstResponse(
            total=payload.total_requests,
            allowed=allowed_count,
            rejected=rejected_count,
            decisions=decisions,
        )

    async def _resolve_active_policy(self) -> RateLimitPolicy:
        active = await self.db_session.get(ActivePolicy, 1)
        if active is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="No active policy configured.",
            )

        policy = await self.db_session.get(RateLimitPolicy, active.policy_id)
        if policy is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Active policy points to a missing policy.",
            )
        if not policy.enabled:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Active policy is disabled.",
            )

        return policy

    async def _validate_run_context(self, run_id: UUID | None) -> None:
        if run_id is None:
            return

        run = await self.db_session.get(ExperimentRun, run_id)
        if run is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Run not found.",
            )
        if run.status != "running":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Run is not in running state.",
            )

    async def _evaluate_request(
        self,
        policy: RateLimitPolicy,
        client_id: str,
        run_id: UUID | None,
    ) -> SimulateDecisionResponse:
        if not client_id.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="client_id cannot be blank.",
            )

        limiter = get_limiter_for_algorithm(policy.algorithm)
        start_ns = time.perf_counter_ns()
        now_ms = int(time.time() * 1000)

        decision = await limiter.allow(
            redis_client=self.redis_client,
            policy_id=str(policy.id),
            client_id=client_id,
            now_ms=now_ms,
            params=policy.params_json,
        )

        latency_ms = max(int((time.perf_counter_ns() - start_ns) / 1_000_000), 0)

        return SimulateDecisionResponse(
            request_id=uuid.uuid4(),
            ts=datetime.now(timezone.utc),
            policy_id=policy.id,
            algorithm=policy.algorithm,
            allowed=decision.allowed,
            reason=decision.reason,
            retry_after_ms=decision.retry_after_ms,
            latency_ms=latency_ms,
            remaining=decision.remaining,
            run_id=run_id,
            client_id=client_id,
            algorithm_state=decision.algorithm_state,
        )

    async def _append_log(self, decision: SimulateDecisionResponse) -> None:
        payload = json.dumps(decision.model_dump(mode="json"))

        global_key = "logs:global"
        await self.redis_client.rpush(global_key, payload)
        await self.redis_client.ltrim(global_key, -LOG_LIST_MAX_LEN, -1)

        if decision.run_id is not None:
            run_key = f"logs:run:{decision.run_id}"
            await self.redis_client.rpush(run_key, payload)
            await self.redis_client.ltrim(run_key, -LOG_LIST_MAX_LEN, -1)
