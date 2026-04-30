package limiter

import (
	"context"
	"testing"
)

type fakeStore struct {
	values  map[string]int64
	expires map[string]int
}

func newFakeStore() *fakeStore {
	return &fakeStore{values: map[string]int64{}, expires: map[string]int{}}
}

func (f *fakeStore) Incr(ctx context.Context, key string) (int64, error) {
	f.values[key]++
	return f.values[key], nil
}

func (f *fakeStore) Expire(ctx context.Context, key string, seconds int) error {
	f.expires[key] = seconds
	return nil
}

func (f *fakeStore) EvalSlidingLog(ctx context.Context, key string, nowMS int64, windowSizeSec int, limit int, requestToken string) (SlidingLogResult, error) {
	return SlidingLogResult{}, nil
}

func TestFixedWindowAllowsUnderLimit(t *testing.T) {
	store := newFakeStore()
	lim := NewFixedWindowLimiter(store)
	params := map[string]any{"window_size_sec": 10, "limit": 2}
	now := int64(1700000000000)

	first, _ := lim.Allow(context.Background(), "p1", "c1", now, params)
	second, _ := lim.Allow(context.Background(), "p1", "c1", now+1, params)

	if !first.Allowed || !second.Allowed {
		t.Fatalf("expected both requests allowed")
	}
	if got := second.AlgorithmState["state_schema_version"]; got != 1 {
		t.Fatalf("expected state_schema_version=1, got %v", got)
	}
}

func TestFixedWindowRejectsOverLimit(t *testing.T) {
	store := newFakeStore()
	lim := NewFixedWindowLimiter(store)
	params := map[string]any{"window_size_sec": 10, "limit": 1}
	now := int64(1700000000000)

	_, _ = lim.Allow(context.Background(), "p1", "c1", now, params)
	blocked, _ := lim.Allow(context.Background(), "p1", "c1", now+1, params)

	if blocked.Allowed {
		t.Fatalf("expected over-limit request rejected")
	}
	if blocked.RetryAfterMS == nil || *blocked.RetryAfterMS <= 0 {
		t.Fatalf("expected retry_after_ms > 0")
	}
}

func TestFixedWindowBoundaryResetsCounter(t *testing.T) {
	store := newFakeStore()
	lim := NewFixedWindowLimiter(store)
	params := map[string]any{"window_size_sec": 10, "limit": 1}

	windowStart := int64(1700000000000)
	nextWindow := windowStart + 10000

	first, _ := lim.Allow(context.Background(), "p1", "c1", windowStart+100, params)
	second, _ := lim.Allow(context.Background(), "p1", "c1", nextWindow+100, params)

	if !first.Allowed || !second.Allowed {
		t.Fatalf("expected requests in different windows allowed")
	}
}
