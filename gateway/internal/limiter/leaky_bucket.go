package limiter

import (
	"context"
	"fmt"
	"math"
)

type LeakyBucketLimiter struct {
	store RuntimeCounter
}

func NewLeakyBucketLimiter(store RuntimeCounter) *LeakyBucketLimiter {
	return &LeakyBucketLimiter{store: store}
}

func (l *LeakyBucketLimiter) Allow(ctx context.Context, policyID, clientID string, nowMS int64, params map[string]any) (Decision, error) {
	capacity, err := readPositiveInt(params, "capacity")
	if err != nil {
		return Decision{}, err
	}
	leakRate, err := readPositiveFloat(params, "leak_rate_per_sec")
	if err != nil {
		return Decision{}, err
	}
	waterPerRequest := 1
	if value, ok := params["water_per_request"]; ok {
		waterPerRequest, err = readPositiveInt(map[string]any{"water_per_request": value}, "water_per_request")
		if err != nil {
			return Decision{}, err
		}
	}

	key := fmt.Sprintf("rl:leaky_bucket:%s:%s", policyID, clientID)
	ttlSec := int(math.Ceil(float64(capacity)/leakRate)) + 1
	if ttlSec < 2 {
		ttlSec = 2
	}

	result, err := l.store.EvalLeakyBucket(ctx, key, nowMS, capacity, leakRate, waterPerRequest, ttlSec)
	if err != nil {
		return Decision{}, err
	}

	headroom := float64(capacity) - result.WaterLevel
	if headroom < 0 {
		headroom = 0
	}
	remaining := int(math.Floor(headroom / float64(waterPerRequest)))
	if remaining < 0 {
		remaining = 0
	}

	state := map[string]any{
		"count":                remaining,
		"window_start_ms":      nowMS,
		"window_size_sec":      0,
		"state_schema_version": 1,
		"water_level":          result.WaterLevel,
		"capacity":             capacity,
		"leak_rate_per_sec":    leakRate,
		"water_per_request":    waterPerRequest,
		"last_leak_ms":         result.LastLeakMS,
	}

	if result.Allowed {
		return Decision{
			Allowed:        true,
			Remaining:      &remaining,
			AlgorithmState: state,
		}, nil
	}

	reason := "rate_limit_exceeded"
	zero := 0
	retryAfter := result.RetryAfterMS
	return Decision{
		Allowed:        false,
		Reason:         &reason,
		Remaining:      &zero,
		RetryAfterMS:   &retryAfter,
		AlgorithmState: state,
	}, nil
}
