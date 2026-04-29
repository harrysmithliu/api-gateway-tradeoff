from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel
from redis.asyncio import Redis


class Decision(BaseModel):
    allowed: bool
    reason: str | None = None
    remaining: int | None = None
    retry_after_ms: int | None = None
    algorithm_state: dict[str, object] | None = None


class RateLimiter(Protocol):
    async def allow(
        self,
        redis_client: Redis,
        policy_id: str,
        client_id: str,
        now_ms: int,
        params: dict[str, object],
    ) -> Decision:
        """Return rate-limiter decision for a single request."""
