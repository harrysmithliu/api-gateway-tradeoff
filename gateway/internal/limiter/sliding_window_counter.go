package limiter

import (
	"context"
	"fmt"
	"math"
)

type SlidingWindowCounterLimiter struct {
	store RuntimeCounter
}

func NewSlidingWindowCounterLimiter(store RuntimeCounter) *SlidingWindowCounterLimiter {
	return &SlidingWindowCounterLimiter{store: store}
}

func (l *SlidingWindowCounterLimiter) Allow(ctx context.Context, policyID, clientID string, nowMS int64, params map[string]any) (Decision, error) {
	windowSizeSec, err := readPositiveInt(params, "window_size_sec")
	if err != nil {
		return Decision{}, err
	}
	limit, err := readPositiveInt(params, "limit")
	if err != nil {
		return Decision{}, err
	}

	windowMS := int64(windowSizeSec * 1000)
	currentWindowStartMS := (nowMS / windowMS) * windowMS
	previousWindowStartMS := currentWindowStartMS - windowMS

	currentKey := fmt.Sprintf("rl:sliding_window_counter:%s:%s:%d", policyID, clientID, currentWindowStartMS)
	previousKey := fmt.Sprintf("rl:sliding_window_counter:%s:%s:%d", policyID, clientID, previousWindowStartMS)

	evalResult, err := l.store.EvalSlidingWindowCounter(ctx, currentKey, previousKey, (windowSizeSec*2)+1)
	if err != nil {
		return Decision{}, err
	}

	elapsedMS := nowMS - currentWindowStartMS
	previousWeight := float64(windowMS-elapsedMS) / float64(windowMS)
	if previousWeight < 0 {
		previousWeight = 0
	}
	if previousWeight > 1 {
		previousWeight = 1
	}

	estimatedCount := float64(evalResult.CurrentWindowCount) + (float64(evalResult.PreviousWindowCount) * previousWeight)
	remaining := int(math.Floor(float64(limit) - estimatedCount))
	if remaining < 0 {
		remaining = 0
	}

	baseState := map[string]any{
		"count":                  estimatedCount,
		"window_start_ms":        currentWindowStartMS,
		"window_size_sec":        windowSizeSec,
		"state_schema_version":   1,
		"current_window_count":   evalResult.CurrentWindowCount,
		"previous_window_count":  evalResult.PreviousWindowCount,
		"previous_window_weight": previousWeight,
		"estimated_count":        estimatedCount,
	}

	if estimatedCount < float64(limit) {
		return Decision{
			Allowed:        true,
			Remaining:      &remaining,
			AlgorithmState: baseState,
		}, nil
	}

	retryAfter := int((currentWindowStartMS + windowMS) - nowMS)
	if retryAfter < 1 {
		retryAfter = 1
	}
	reason := "rate_limit_exceeded"
	zero := 0
	return Decision{
		Allowed:        false,
		Reason:         &reason,
		Remaining:      &zero,
		RetryAfterMS:   &retryAfter,
		AlgorithmState: baseState,
	}, nil
}
