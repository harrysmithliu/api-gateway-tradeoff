package limiter

import (
	"context"
	"fmt"
	"math"
)

type TokenBucketLimiter struct {
	store RuntimeCounter
}

func NewTokenBucketLimiter(store RuntimeCounter) *TokenBucketLimiter {
	return &TokenBucketLimiter{store: store}
}

func (l *TokenBucketLimiter) Allow(ctx context.Context, policyID, clientID string, nowMS int64, params map[string]any) (Decision, error) {
	capacity, err := readPositiveInt(params, "capacity")
	if err != nil {
		return Decision{}, err
	}
	refillRate, err := readPositiveFloat(params, "refill_rate_per_sec")
	if err != nil {
		return Decision{}, err
	}
	tokensPerRequest := 1
	if value, ok := params["tokens_per_request"]; ok {
		tokensPerRequest, err = readPositiveInt(map[string]any{"tokens_per_request": value}, "tokens_per_request")
		if err != nil {
			return Decision{}, err
		}
	}

	key := fmt.Sprintf("rl:token_bucket:%s:%s", policyID, clientID)
	ttlSec := int(math.Ceil(float64(capacity)/refillRate)) + 1
	if ttlSec < 2 {
		ttlSec = 2
	}

	result, err := l.store.EvalTokenBucket(ctx, key, nowMS, capacity, refillRate, tokensPerRequest, ttlSec)
	if err != nil {
		return Decision{}, err
	}

	remainingBudget := int(math.Floor(result.Tokens / float64(tokensPerRequest)))
	if remainingBudget < 0 {
		remainingBudget = 0
	}

	state := map[string]any{
		"count":                remainingBudget,
		"window_start_ms":      nowMS,
		"window_size_sec":      0,
		"state_schema_version": 1,
		"tokens":               result.Tokens,
		"capacity":             capacity,
		"refill_rate_per_sec":  refillRate,
		"tokens_per_request":   tokensPerRequest,
		"last_refill_ms":       result.LastRefillMS,
	}

	if result.Allowed {
		return Decision{
			Allowed:        true,
			Remaining:      &remainingBudget,
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

func readPositiveFloat(input map[string]any, key string) (float64, error) {
	value, ok := input[key]
	if !ok {
		return 0, fmt.Errorf("missing required field %s", key)
	}
	switch v := value.(type) {
	case float64:
		if v <= 0 {
			return 0, fmt.Errorf("field %s must be > 0", key)
		}
		return v, nil
	case int:
		if v <= 0 {
			return 0, fmt.Errorf("field %s must be > 0", key)
		}
		return float64(v), nil
	default:
		return 0, fmt.Errorf("field %s must be numeric", key)
	}
}
