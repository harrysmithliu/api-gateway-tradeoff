from __future__ import annotations

from fastapi import HTTPException, status

from app.limiters.base import RateLimiter
from app.limiters.fixed_window import FixedWindowLimiter
from app.limiters.leaky_bucket import LeakyBucketLimiter
from app.limiters.sliding_log import SlidingLogLimiter
from app.limiters.sliding_window_counter import SlidingWindowCounterLimiter
from app.limiters.token_bucket import TokenBucketLimiter

LIMITER_BY_ALGORITHM: dict[str, RateLimiter] = {
    "fixed_window": FixedWindowLimiter(),
    "sliding_log": SlidingLogLimiter(),
    "sliding_window_counter": SlidingWindowCounterLimiter(),
    "token_bucket": TokenBucketLimiter(),
    "leaky_bucket": LeakyBucketLimiter(),
}


def get_limiter_for_algorithm(algorithm: str) -> RateLimiter:
    limiter = LIMITER_BY_ALGORITHM.get(algorithm)
    if limiter is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unsupported limiter algorithm '{algorithm}'.",
        )
    return limiter
