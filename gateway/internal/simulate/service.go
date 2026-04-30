package simulate

import (
	"context"
	"errors"
	"time"

	"gateway/internal/limiter"
	"gateway/internal/policy"
	"gateway/internal/runtime"

	"github.com/google/uuid"
)

type Response struct {
	RequestID      string         `json:"request_id"`
	TS             time.Time      `json:"ts"`
	PolicyID       string         `json:"policy_id"`
	Algorithm      string         `json:"algorithm"`
	Allowed        bool           `json:"allowed"`
	Reason         *string        `json:"reason,omitempty"`
	RetryAfterMS   *int           `json:"retry_after_ms,omitempty"`
	LatencyMS      int            `json:"latency_ms"`
	Remaining      *int           `json:"remaining,omitempty"`
	AlgorithmState map[string]any `json:"algorithm_state,omitempty"`
}

type Service struct {
	policies *policy.Service
	store    runtime.Store
}

func NewService(policies *policy.Service, store runtime.Store) *Service {
	return &Service{policies: policies, store: store}
}

func (s *Service) Evaluate(ctx context.Context, clientID string) (Response, error) {
	active, err := s.policies.Active(ctx)
	if err != nil {
		return Response{}, err
	}

	limiterImpl, err := limiter.BuildLimiter(active.Algorithm, &storeAdapter{store: s.store})
	if err != nil {
		return Response{}, err
	}

	start := time.Now()
	nowMS := start.UnixMilli()
	decision, err := limiterImpl.Allow(ctx, active.ID, clientID, nowMS, active.ParamsJSON)
	if err != nil {
		return Response{}, err
	}

	latencyMS := int(time.Since(start).Milliseconds())
	if latencyMS < 0 {
		latencyMS = 0
	}

	return Response{
		RequestID:      uuid.NewString(),
		TS:             time.Now().UTC(),
		PolicyID:       active.ID,
		Algorithm:      active.Algorithm,
		Allowed:        decision.Allowed,
		Reason:         decision.Reason,
		RetryAfterMS:   decision.RetryAfterMS,
		LatencyMS:      latencyMS,
		Remaining:      decision.Remaining,
		AlgorithmState: decision.AlgorithmState,
	}, nil
}

type storeAdapter struct {
	store runtime.Store
}

func (a *storeAdapter) Incr(ctx context.Context, key string) (int64, error) {
	return a.store.Incr(ctx, key)
}

func (a *storeAdapter) Expire(ctx context.Context, key string, seconds int) error {
	if seconds <= 0 {
		return errors.New("ttl seconds must be positive")
	}
	return a.store.Expire(ctx, key, time.Duration(seconds)*time.Second)
}

func (a *storeAdapter) EvalSlidingLog(ctx context.Context, key string, nowMS int64, windowSizeSec int, limit int, requestToken string) (limiter.SlidingLogResult, error) {
	res, err := a.store.EvalSlidingLog(ctx, key, nowMS, windowSizeSec, limit, requestToken)
	if err != nil {
		return limiter.SlidingLogResult{}, err
	}
	return limiter.SlidingLogResult{
		Allowed:       res.Allowed,
		Count:         res.Count,
		Remaining:     res.Remaining,
		RetryAfterMS:  res.RetryAfterMS,
		WindowStartMS: res.WindowStart,
		WindowSizeSec: res.WindowSize,
	}, nil
}
