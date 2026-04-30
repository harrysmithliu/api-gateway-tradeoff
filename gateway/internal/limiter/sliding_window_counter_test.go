package limiter

import (
	"context"
	"fmt"
	"testing"
)

type fakeSlidingWindowCounterStore struct {
	counts map[string]int64
}

func newFakeSlidingWindowCounterStore() *fakeSlidingWindowCounterStore {
	return &fakeSlidingWindowCounterStore{counts: map[string]int64{}}
}

func (f *fakeSlidingWindowCounterStore) Incr(ctx context.Context, key string) (int64, error) {
	return 0, fmt.Errorf("not used by sliding window counter tests")
}

func (f *fakeSlidingWindowCounterStore) Expire(ctx context.Context, key string, seconds int) error {
	return nil
}

func (f *fakeSlidingWindowCounterStore) EvalSlidingLog(ctx context.Context, key string, nowMS int64, windowSizeSec int, limit int, requestToken string) (SlidingLogResult, error) {
	return SlidingLogResult{}, nil
}

func (f *fakeSlidingWindowCounterStore) EvalSlidingWindowCounter(ctx context.Context, currentKey string, previousKey string, ttlSec int) (SlidingWindowCounterResult, error) {
	f.counts[currentKey]++
	return SlidingWindowCounterResult{
		CurrentWindowCount:  f.counts[currentKey],
		PreviousWindowCount: f.counts[previousKey],
	}, nil
}

func (f *fakeSlidingWindowCounterStore) EvalTokenBucket(ctx context.Context, key string, nowMS int64, capacity int, refillRatePerSec float64, tokensPerRequest int, ttlSec int) (TokenBucketResult, error) {
	return TokenBucketResult{}, nil
}

func (f *fakeSlidingWindowCounterStore) EvalLeakyBucket(ctx context.Context, key string, nowMS int64, capacity int, leakRatePerSec float64, waterPerRequest int, ttlSec int) (LeakyBucketResult, error) {
	return LeakyBucketResult{}, nil
}

func TestSlidingWindowCounterAllowsUnderLimit(t *testing.T) {
	store := newFakeSlidingWindowCounterStore()
	lim := NewSlidingWindowCounterLimiter(store)
	params := map[string]any{"window_size_sec": 10, "limit": 3}
	now := int64(1700000001000)

	decision, err := lim.Allow(context.Background(), "p1", "c1", now, params)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !decision.Allowed {
		t.Fatalf("expected under-limit request to be allowed")
	}
	if decision.Remaining == nil || *decision.Remaining != 2 {
		t.Fatalf("expected remaining=2, got %+v", decision.Remaining)
	}
}

func TestSlidingWindowCounterRejectsOverLimit(t *testing.T) {
	store := newFakeSlidingWindowCounterStore()
	lim := NewSlidingWindowCounterLimiter(store)
	params := map[string]any{"window_size_sec": 10, "limit": 2}
	now := int64(1700000001000)

	_, _ = lim.Allow(context.Background(), "p1", "c1", now, params)
	blocked, err := lim.Allow(context.Background(), "p1", "c1", now+1, params)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if blocked.Allowed {
		t.Fatalf("expected request to be rejected at estimated_count >= limit")
	}
	if blocked.RetryAfterMS == nil || *blocked.RetryAfterMS <= 0 {
		t.Fatalf("expected retry_after_ms > 0, got %+v", blocked.RetryAfterMS)
	}
}

func TestSlidingWindowCounterSmoothsBoundaryTransition(t *testing.T) {
	store := newFakeSlidingWindowCounterStore()
	lim := NewSlidingWindowCounterLimiter(store)
	params := map[string]any{"window_size_sec": 10, "limit": 3}
	base := int64(1700000000000)

	_, _ = lim.Allow(context.Background(), "p1", "c1", base+9000, params)
	_, _ = lim.Allow(context.Background(), "p1", "c1", base+9001, params)
	_, _ = lim.Allow(context.Background(), "p1", "c1", base+9002, params)

	atBoundary, err := lim.Allow(context.Background(), "p1", "c1", base+10100, params)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if atBoundary.Allowed {
		t.Fatalf("expected boundary request rejected due to weighted previous-window contribution")
	}
}

func TestSlidingWindowCounterStateIncludesBaselineAndSWCFields(t *testing.T) {
	store := newFakeSlidingWindowCounterStore()
	lim := NewSlidingWindowCounterLimiter(store)
	params := map[string]any{"window_size_sec": 10, "limit": 5}
	now := int64(1700000001000)

	decision, err := lim.Allow(context.Background(), "p1", "c1", now, params)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	requiredFields := []string{
		"count",
		"window_start_ms",
		"window_size_sec",
		"state_schema_version",
		"current_window_count",
		"previous_window_count",
		"previous_window_weight",
		"estimated_count",
	}
	for _, field := range requiredFields {
		if _, ok := decision.AlgorithmState[field]; !ok {
			t.Fatalf("expected algorithm_state to include field %s", field)
		}
	}
	if decision.AlgorithmState["state_schema_version"] != 1 {
		t.Fatalf("expected state_schema_version=1")
	}
}
