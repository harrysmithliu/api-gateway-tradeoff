package limiter

import (
	"context"
	"fmt"
)

type FixedWindowLimiter struct {
	store RuntimeCounter
}

func NewFixedWindowLimiter(store RuntimeCounter) *FixedWindowLimiter {
	return &FixedWindowLimiter{store: store}
}

func (l *FixedWindowLimiter) Allow(ctx context.Context, policyID, clientID string, nowMS int64, params map[string]any) (Decision, error) {
	windowSizeSec, err := readPositiveInt(params, "window_size_sec")
	if err != nil {
		return Decision{}, err
	}
	limit, err := readPositiveInt(params, "limit")
	if err != nil {
		return Decision{}, err
	}

	windowMS := int64(windowSizeSec * 1000)
	windowStartMS := (nowMS / windowMS) * windowMS
	key := fmt.Sprintf("rl:fixed_window:%s:%s:%d", policyID, clientID, windowStartMS)

	count, err := l.store.Incr(ctx, key)
	if err != nil {
		return Decision{}, err
	}
	if count == 1 {
		if err := l.store.Expire(ctx, key, windowSizeSec+1); err != nil {
			return Decision{}, err
		}
	}

	remaining := limit - int(count)
	if count <= int64(limit) {
		if remaining < 0 {
			remaining = 0
		}
		return Decision{
			Allowed:   true,
			Remaining: &remaining,
			AlgorithmState: map[string]any{
				"count":           count,
				"window_start_ms": windowStartMS,
			},
		}, nil
	}

	retryAfter := int((windowStartMS + windowMS) - nowMS)
	if retryAfter < 1 {
		retryAfter = 1
	}
	reason := "rate_limit_exceeded"
	zero := 0
	return Decision{
		Allowed:      false,
		Reason:       &reason,
		Remaining:    &zero,
		RetryAfterMS: &retryAfter,
		AlgorithmState: map[string]any{
			"count":           count,
			"window_start_ms": windowStartMS,
		},
	}, nil
}

func readPositiveInt(input map[string]any, key string) (int, error) {
	value, ok := input[key]
	if !ok {
		return 0, fmt.Errorf("missing required field %s", key)
	}
	switch v := value.(type) {
	case float64:
		if v <= 0 {
			return 0, fmt.Errorf("field %s must be > 0", key)
		}
		return int(v), nil
	case int:
		if v <= 0 {
			return 0, fmt.Errorf("field %s must be > 0", key)
		}
		return v, nil
	default:
		return 0, fmt.Errorf("field %s must be numeric", key)
	}
}
