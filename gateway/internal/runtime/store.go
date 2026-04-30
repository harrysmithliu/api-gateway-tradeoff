package runtime

import (
	"context"
	"time"
)

type Store interface {
	Incr(ctx context.Context, key string) (int64, error)
	Expire(ctx context.Context, key string, ttl time.Duration) error
	ScanDelete(ctx context.Context, pattern string, batch int64) error
	Ping(ctx context.Context) error
}
