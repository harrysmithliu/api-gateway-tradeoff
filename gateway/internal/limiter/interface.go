package limiter

import "context"

type SlidingLogResult struct {
	Allowed       bool
	Count         int64
	Remaining     int
	RetryAfterMS  int
	WindowStartMS int64
	WindowSizeSec int
}

type RuntimeCounter interface {
	Incr(ctx context.Context, key string) (int64, error)
	Expire(ctx context.Context, key string, seconds int) error
	EvalSlidingLog(ctx context.Context, key string, nowMS int64, windowSizeSec int, limit int, requestToken string) (SlidingLogResult, error)
}

type Limiter interface {
	Allow(ctx context.Context, policyID, clientID string, nowMS int64, params map[string]any) (Decision, error)
}
