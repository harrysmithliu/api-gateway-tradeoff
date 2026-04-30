package limiter

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

type SlidingLogLimiter struct {
	store RuntimeCounter
}

func NewSlidingLogLimiter(store RuntimeCounter) *SlidingLogLimiter {
	return &SlidingLogLimiter{store: store}
}

func (l *SlidingLogLimiter) Allow(ctx context.Context, policyID, clientID string, nowMS int64, params map[string]any) (Decision, error) {
	windowSizeSec, err := readPositiveInt(params, "window_size_sec")
	if err != nil {
		return Decision{}, err
	}
	limit, err := readPositiveInt(params, "limit")
	if err != nil {
		return Decision{}, err
	}

	key := fmt.Sprintf("rl:sliding_log:%s:%s", policyID, clientID)
	requestToken := fmt.Sprintf("%d:%s", nowMS, uuid.NewString())

	result, err := l.store.EvalSlidingLog(ctx, key, nowMS, windowSizeSec, limit, requestToken)
	if err != nil {
		return Decision{}, err
	}

	remaining := result.Remaining
	decision := Decision{
		Allowed:   result.Allowed,
		Remaining: &remaining,
		AlgorithmState: map[string]any{
			"count":                result.Count,
			"window_start_ms":      result.WindowStartMS,
			"window_size_sec":      result.WindowSizeSec,
			"state_schema_version": 1,
		},
	}

	if !result.Allowed {
		reason := "rate_limit_exceeded"
		retryAfter := result.RetryAfterMS
		decision.Reason = &reason
		decision.RetryAfterMS = &retryAfter
	}

	return decision, nil
}
