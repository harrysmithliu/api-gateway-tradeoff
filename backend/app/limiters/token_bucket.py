from __future__ import annotations

import math

from redis.asyncio import Redis

from app.limiters.base import Decision


class TokenBucketLimiter:
    algorithm = "token_bucket"

    async def allow(
        self,
        redis_client: Redis,
        policy_id: str,
        client_id: str,
        now_ms: int,
        params: dict[str, object],
    ) -> Decision:
        capacity = float(params["capacity"])
        refill_rate_per_sec = float(params["refill_rate_per_sec"])
        tokens_per_request = float(params.get("tokens_per_request", 1))

        key = f"rl:token:{policy_id}:{client_id}"
        tokens_raw, last_refill_raw = await redis_client.hmget(key, "tokens", "last_refill_ms")

        if tokens_raw is None or last_refill_raw is None:
            tokens = capacity
            last_refill_ms = now_ms
        else:
            tokens = float(tokens_raw)
            last_refill_ms = int(float(last_refill_raw))

        elapsed_sec = max((now_ms - last_refill_ms) / 1000.0, 0.0)
        refilled_tokens = min(capacity, tokens + (elapsed_sec * refill_rate_per_sec))

        allowed = refilled_tokens >= tokens_per_request
        if allowed:
            remaining_tokens = refilled_tokens - tokens_per_request
            reason = None
            retry_after_ms = None
        else:
            remaining_tokens = refilled_tokens
            reason = "rate_limit_exceeded"
            needed_tokens = tokens_per_request - refilled_tokens
            retry_after_ms = max(int(math.ceil((needed_tokens / refill_rate_per_sec) * 1000)), 1)

        ttl_sec = max(int(math.ceil(capacity / refill_rate_per_sec)) + 2, 2)
        await redis_client.hset(
            key,
            mapping={
                "tokens": f"{remaining_tokens:.8f}",
                "last_refill_ms": now_ms,
            },
        )
        await redis_client.expire(key, ttl_sec)

        remaining_requests = int(max(math.floor(remaining_tokens / tokens_per_request), 0))
        return Decision(
            allowed=allowed,
            reason=reason,
            remaining=remaining_requests,
            retry_after_ms=retry_after_ms,
            algorithm_state={"tokens": round(remaining_tokens, 4)},
        )
