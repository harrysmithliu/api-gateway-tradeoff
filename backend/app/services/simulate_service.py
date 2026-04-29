from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.limiters.factory import get_limiter_for_algorithm
from app.models.active_policy import ActivePolicy
from app.models.policy import RateLimitPolicy
from app.schemas.simulate import SimulateDecisionResponse, SimulateRequestPayload


class SimulateService:
    def __init__(self, db_session: AsyncSession, redis_client: Redis):
        self.db_session = db_session
        self.redis_client = redis_client

    async def simulate_one(self, payload: SimulateRequestPayload) -> SimulateDecisionResponse:
        if not payload.client_id.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="client_id cannot be blank.",
            )

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

        limiter = get_limiter_for_algorithm(policy.algorithm)
        start_ns = time.perf_counter_ns()
        now_ms = int(time.time() * 1000)

        decision = await limiter.allow(
            redis_client=self.redis_client,
            policy_id=str(policy.id),
            client_id=payload.client_id,
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
            run_id=payload.run_id,
            algorithm_state=decision.algorithm_state,
        )
