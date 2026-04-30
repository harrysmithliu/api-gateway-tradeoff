package runtime

import (
	"context"
	"time"
)

type SlidingLogEvalResult struct {
	Allowed      bool
	Count        int64
	Remaining    int
	RetryAfterMS int
	WindowStart  int64
	WindowSize   int
}

type Store interface {
	Incr(ctx context.Context, key string) (int64, error)
	Expire(ctx context.Context, key string, ttl time.Duration) error
	EvalSlidingLog(ctx context.Context, key string, nowMS int64, windowSizeSec int, limit int, requestToken string) (SlidingLogEvalResult, error)
	ScanDelete(ctx context.Context, pattern string, batch int64) error
	Ping(ctx context.Context) error
}
