from __future__ import annotations

import math

from redis.asyncio import Redis

from app.limiters.base import Decision


class SlidingWindowCounterLimiter:
    algorithm = "sliding_window_counter"

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
        curr_window_start = (now_ms // window_ms) * window_ms
        prev_window_start = curr_window_start - window_ms

        curr_key = f"rl:swc:{policy_id}:{client_id}:curr:{curr_window_start}"
        prev_key = f"rl:swc:{policy_id}:{client_id}:prev:{prev_window_start}"

        curr_raw, prev_raw = await redis_client.mget(curr_key, prev_key)
        curr_count = int(curr_raw or 0)
        prev_count = int(prev_raw or 0)

        elapsed_ms = now_ms - curr_window_start
        prev_weight = max((window_ms - elapsed_ms) / window_ms, 0)
        effective_count = curr_count + (prev_count * prev_weight)

        if effective_count < limit:
            new_count = int(await redis_client.incr(curr_key))
            await redis_client.expire(curr_key, window_size_sec * 2)
            await redis_client.expire(prev_key, window_size_sec * 2)

            remaining = max(int(math.floor(limit - (effective_count + 1))), 0)
            return Decision(
                allowed=True,
                remaining=remaining,
                algorithm_state={
                    "curr_count": new_count,
                    "prev_count": prev_count,
                    "effective_count": round(effective_count + 1, 4),
                },
            )

        retry_after_ms = max((curr_window_start + window_ms) - now_ms, 1)
        return Decision(
            allowed=False,
            reason="rate_limit_exceeded",
            remaining=0,
            retry_after_ms=retry_after_ms,
            algorithm_state={
                "curr_count": curr_count,
                "prev_count": prev_count,
                "effective_count": round(effective_count, 4),
            },
        )
