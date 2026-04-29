from __future__ import annotations

import math

from redis.asyncio import Redis

from app.limiters.base import Decision


class LeakyBucketLimiter:
    algorithm = "leaky_bucket"

    async def allow(
        self,
        redis_client: Redis,
        policy_id: str,
        client_id: str,
        now_ms: int,
        params: dict[str, object],
    ) -> Decision:
        capacity = float(params["capacity"])
        leak_rate_per_sec = float(params["leak_rate_per_sec"])
        water_per_request = float(params.get("water_per_request", 1))

        key = f"rl:leaky:{policy_id}:{client_id}"
        water_raw, last_leak_raw = await redis_client.hmget(key, "water_level", "last_leak_ms")

        if water_raw is None or last_leak_raw is None:
            water_level = 0.0
            last_leak_ms = now_ms
        else:
            water_level = float(water_raw)
            last_leak_ms = int(float(last_leak_raw))

        elapsed_sec = max((now_ms - last_leak_ms) / 1000.0, 0.0)
        leaked_water = elapsed_sec * leak_rate_per_sec
        water_level = max(water_level - leaked_water, 0.0)

        if water_level + water_per_request <= capacity:
            water_level += water_per_request
            allowed = True
            reason = None
            retry_after_ms = None
        else:
            allowed = False
            reason = "rate_limit_exceeded"
            overflow = (water_level + water_per_request) - capacity
            retry_after_ms = max(int(math.ceil((overflow / leak_rate_per_sec) * 1000)), 1)

        ttl_sec = max(int(math.ceil(capacity / leak_rate_per_sec)) + 2, 2)
        await redis_client.hset(
            key,
            mapping={
                "water_level": f"{water_level:.8f}",
                "last_leak_ms": now_ms,
            },
        )
        await redis_client.expire(key, ttl_sec)

        remaining = int(max(math.floor((capacity - water_level) / water_per_request), 0))
        return Decision(
            allowed=allowed,
            reason=reason,
            remaining=remaining,
            retry_after_ms=retry_after_ms,
            algorithm_state={"water_level": round(water_level, 4)},
        )
