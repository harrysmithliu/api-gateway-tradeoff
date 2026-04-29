from __future__ import annotations

from redis.asyncio import Redis

from app.limiters.base import Decision


class FixedWindowLimiter:
    algorithm = "fixed_window"

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
        window_start_ms = (now_ms // window_ms) * window_ms
        key = f"rl:fixed_window:{policy_id}:{client_id}:{window_start_ms}"

        count = int(await redis_client.incr(key))
        if count == 1:
            await redis_client.expire(key, window_size_sec + 1)

        if count <= limit:
            return Decision(
                allowed=True,
                remaining=max(limit - count, 0),
                algorithm_state={"count": count, "window_start_ms": window_start_ms},
            )

        retry_after_ms = max(window_start_ms + window_ms - now_ms, 1)
        return Decision(
            allowed=False,
            reason="rate_limit_exceeded",
            remaining=0,
            retry_after_ms=retry_after_ms,
            algorithm_state={"count": count, "window_start_ms": window_start_ms},
        )
