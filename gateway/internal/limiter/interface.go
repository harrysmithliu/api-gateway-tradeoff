package limiter

import "context"

type RuntimeCounter interface {
	Incr(ctx context.Context, key string) (int64, error)
	Expire(ctx context.Context, key string, seconds int) error
}

type Limiter interface {
	Allow(ctx context.Context, policyID, clientID string, nowMS int64, params map[string]any) (Decision, error)
}
