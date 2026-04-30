package limiter

import (
	"context"
	"fmt"
	"testing"
)

type fakeSlidingLogStore struct {
	events map[string][]int64
}

func newFakeSlidingLogStore() *fakeSlidingLogStore {
	return &fakeSlidingLogStore{events: map[string][]int64{}}
}

func (f *fakeSlidingLogStore) Incr(ctx context.Context, key string) (int64, error) {
	return 0, fmt.Errorf("not used by sliding_log tests")
}

func (f *fakeSlidingLogStore) Expire(ctx context.Context, key string, seconds int) error {
	return nil
}

func (f *fakeSlidingLogStore) EvalSlidingLog(ctx context.Context, key string, nowMS int64, windowSizeSec int, limit int, requestToken string) (SlidingLogResult, error) {
	windowMS := int64(windowSizeSec * 1000)
	windowStartMS := nowMS - windowMS

	entries := f.events[key]
	filtered := make([]int64, 0, len(entries))
	for _, ts := range entries {
		if ts >= windowStartMS {
			filtered = append(filtered, ts)
		}
	}

	if len(filtered) < limit {
		filtered = append(filtered, nowMS)
		f.events[key] = filtered
		return SlidingLogResult{
			Allowed:       true,
			Count:         int64(len(filtered)),
			Remaining:     limit - len(filtered),
			RetryAfterMS:  0,
			WindowStartMS: windowStartMS,
			WindowSizeSec: windowSizeSec,
		}, nil
	}

	retryAfterMS := 1
	if len(filtered) > 0 {
		retryAfterMS = int((filtered[0] + windowMS) - nowMS)
		if retryAfterMS < 1 {
			retryAfterMS = 1
		}
	}
	f.events[key] = filtered
	return SlidingLogResult{
		Allowed:       false,
		Count:         int64(len(filtered)),
		Remaining:     0,
		RetryAfterMS:  retryAfterMS,
		WindowStartMS: windowStartMS,
		WindowSizeSec: windowSizeSec,
	}, nil
}

func (f *fakeSlidingLogStore) EvalSlidingWindowCounter(ctx context.Context, currentKey string, previousKey string, ttlSec int) (SlidingWindowCounterResult, error) {
	return SlidingWindowCounterResult{}, nil
}

func (f *fakeSlidingLogStore) EvalTokenBucket(ctx context.Context, key string, nowMS int64, capacity int, refillRatePerSec float64, tokensPerRequest int, ttlSec int) (TokenBucketResult, error) {
	return TokenBucketResult{}, nil
}

func (f *fakeSlidingLogStore) EvalLeakyBucket(ctx context.Context, key string, nowMS int64, capacity int, leakRatePerSec float64, waterPerRequest int, ttlSec int) (LeakyBucketResult, error) {
	return LeakyBucketResult{}, nil
}

func TestSlidingLogAllowsUnderLimit(t *testing.T) {
	store := newFakeSlidingLogStore()
	lim := NewSlidingLogLimiter(store)
	params := map[string]any{"window_size_sec": 5, "limit": 3}
	now := int64(1700000000000)

	first, _ := lim.Allow(context.Background(), "p1", "c1", now, params)
	second, _ := lim.Allow(context.Background(), "p1", "c1", now+10, params)

	if !first.Allowed || !second.Allowed {
		t.Fatalf("expected requests under limit to be allowed")
	}
	if second.Remaining == nil || *second.Remaining != 1 {
		t.Fatalf("expected remaining=1 after second request, got %+v", second.Remaining)
	}
	if got := second.AlgorithmState["state_schema_version"]; got != 1 {
		t.Fatalf("expected state_schema_version=1, got %v", got)
	}
}

func TestSlidingLogRejectsWhenLimitExceeded(t *testing.T) {
	store := newFakeSlidingLogStore()
	lim := NewSlidingLogLimiter(store)
	params := map[string]any{"window_size_sec": 10, "limit": 1}
	now := int64(1700000000000)

	_, _ = lim.Allow(context.Background(), "p1", "c1", now, params)
	blocked, _ := lim.Allow(context.Background(), "p1", "c1", now+1, params)

	if blocked.Allowed {
		t.Fatalf("expected over-limit request rejected")
	}
	if blocked.RetryAfterMS == nil || *blocked.RetryAfterMS <= 0 {
		t.Fatalf("expected retry_after_ms > 0, got %+v", blocked.RetryAfterMS)
	}
	if blocked.Reason == nil || *blocked.Reason != "rate_limit_exceeded" {
		t.Fatalf("expected rate_limit_exceeded reason")
	}
}

func TestSlidingLogReAllowsAfterWindowSlides(t *testing.T) {
	store := newFakeSlidingLogStore()
	lim := NewSlidingLogLimiter(store)
	params := map[string]any{"window_size_sec": 1, "limit": 1}
	now := int64(1700000000000)

	first, _ := lim.Allow(context.Background(), "p1", "c1", now, params)
	blocked, _ := lim.Allow(context.Background(), "p1", "c1", now+100, params)
	afterSlide, _ := lim.Allow(context.Background(), "p1", "c1", now+1001, params)

	if !first.Allowed {
		t.Fatalf("first request should be allowed")
	}
	if blocked.Allowed {
		t.Fatalf("second request should be rejected within the same sliding window")
	}
	if !afterSlide.Allowed {
		t.Fatalf("request should be allowed after window slides")
	}
}

func TestSlidingLogRetryAfterBasedOnOldestInWindow(t *testing.T) {
	store := newFakeSlidingLogStore()
	lim := NewSlidingLogLimiter(store)
	params := map[string]any{"window_size_sec": 1, "limit": 2}

	_, _ = lim.Allow(context.Background(), "p1", "c1", 1000, params)
	_, _ = lim.Allow(context.Background(), "p1", "c1", 1200, params)
	blocked, _ := lim.Allow(context.Background(), "p1", "c1", 1500, params)

	if blocked.Allowed {
		t.Fatalf("expected blocked request")
	}
	if blocked.RetryAfterMS == nil {
		t.Fatalf("expected retry_after_ms in blocked decision")
	}
	if *blocked.RetryAfterMS != 500 {
		t.Fatalf("expected retry_after_ms=500, got %d", *blocked.RetryAfterMS)
	}
}
