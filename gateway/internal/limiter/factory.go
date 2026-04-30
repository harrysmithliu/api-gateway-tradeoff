package limiter

import (
	"fmt"
)

func BuildLimiter(algorithm string, store RuntimeCounter) (Limiter, error) {
	switch algorithm {
	case "fixed_window":
		return NewFixedWindowLimiter(store), nil
	case "sliding_log":
		return NewSlidingLogLimiter(store), nil
	case "sliding_window_counter":
		return NewSlidingWindowCounterLimiter(store), nil
	case "token_bucket":
		return NewTokenBucketLimiter(store), nil
	case "leaky_bucket":
		return NewLeakyBucketLimiter(store), nil
	default:
		return nil, fmt.Errorf("unsupported algorithm '%s'", algorithm)
	}
}
