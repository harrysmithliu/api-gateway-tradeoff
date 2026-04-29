from __future__ import annotations

import uuid
import math

from redis.asyncio import Redis

from app.limiters.base import Decision


class SlidingLogLimiter:
    algorithm = "sliding_log"

    async def allow(
        self,
        redis_client: Redis,
        policy_id: str,
        client_id: str,
        now_ms: int,
        params: dict[str, object],
    ) -> Decision:
        window_size_sec = int(params["window_size_sec"])
        limit = int(params["limit"])

        window_ms = window_size_sec * 1000
        trim_before = now_ms - window_ms
        key = f"rl:sliding_log:{policy_id}:{client_id}"

        await redis_client.zremrangebyscore(key, 0, trim_before)
        current_count = int(await redis_client.zcard(key))

        if current_count < limit:
            member = f"{now_ms}:{uuid.uuid4()}"
            await redis_client.zadd(key, {member: float(now_ms)})
            await redis_client.expire(key, window_size_sec + 1)
            return Decision(
                allowed=True,
                remaining=max(limit - (current_count + 1), 0),
                algorithm_state={"count": current_count + 1},
            )

        oldest_entries = await redis_client.zrange(key, 0, 0, withscores=True)
        retry_after_ms = 1
        if oldest_entries:
            oldest_ts = int(oldest_entries[0][1])
            retry_after_ms = max((oldest_ts + window_ms) - now_ms, 1)

        return Decision(
            allowed=False,
            reason="rate_limit_exceeded",
            remaining=0,
            retry_after_ms=int(math.ceil(retry_after_ms)),
            algorithm_state={"count": current_count},
        )
