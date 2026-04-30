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
	case "sliding_window_counter", "token_bucket", "leaky_bucket":
		return nil, fmt.Errorf("algorithm '%s' is not implemented in current milestone", algorithm)
	default:
		return nil, fmt.Errorf("unsupported algorithm '%s'", algorithm)
	}
}
