package limiter

import (
	"context"
	"fmt"
	"math"
	"testing"
)

type fakeLeakyBucketState struct {
	waterLevel  float64
	lastLeakMS  int64
	initialized bool
}

type fakeLeakyBucketStore struct {
	state map[string]fakeLeakyBucketState
}

func newFakeLeakyBucketStore() *fakeLeakyBucketStore {
	return &fakeLeakyBucketStore{state: map[string]fakeLeakyBucketState{}}
}

func (f *fakeLeakyBucketStore) Incr(ctx context.Context, key string) (int64, error) {
	return 0, fmt.Errorf("not used by leaky bucket tests")
}

func (f *fakeLeakyBucketStore) Expire(ctx context.Context, key string, seconds int) error {
	return nil
}

func (f *fakeLeakyBucketStore) EvalSlidingLog(ctx context.Context, key string, nowMS int64, windowSizeSec int, limit int, requestToken string) (SlidingLogResult, error) {
	return SlidingLogResult{}, nil
}

func (f *fakeLeakyBucketStore) EvalSlidingWindowCounter(ctx context.Context, currentKey string, previousKey string, ttlSec int) (SlidingWindowCounterResult, error) {
	return SlidingWindowCounterResult{}, nil
}

func (f *fakeLeakyBucketStore) EvalTokenBucket(ctx context.Context, key string, nowMS int64, capacity int, refillRatePerSec float64, tokensPerRequest int, ttlSec int) (TokenBucketResult, error) {
	return TokenBucketResult{}, nil
}

func (f *fakeLeakyBucketStore) EvalLeakyBucket(ctx context.Context, key string, nowMS int64, capacity int, leakRatePerSec float64, waterPerRequest int, ttlSec int) (LeakyBucketResult, error) {
	st := f.state[key]
	if !st.initialized {
		st.waterLevel = 0
		st.lastLeakMS = nowMS
		st.initialized = true
	}

	elapsed := nowMS - st.lastLeakMS
	if elapsed < 0 {
		elapsed = 0
	}
	st.waterLevel -= (float64(elapsed) / 1000.0) * leakRatePerSec
	if st.waterLevel < 0 {
		st.waterLevel = 0
	}

	allowed := false
	retryAfter := 0
	if st.waterLevel+float64(waterPerRequest) <= float64(capacity) {
		allowed = true
		st.waterLevel += float64(waterPerRequest)
	} else {
		overflow := (st.waterLevel + float64(waterPerRequest)) - float64(capacity)
		retryAfter = int(math.Ceil((overflow / leakRatePerSec) * 1000))
		if retryAfter < 1 {
			retryAfter = 1
		}
	}

	st.lastLeakMS = nowMS
	f.state[key] = st
	return LeakyBucketResult{
		Allowed:      allowed,
		WaterLevel:   st.waterLevel,
		LastLeakMS:   st.lastLeakMS,
		RetryAfterMS: retryAfter,
	}, nil
}

func TestLeakyBucketAllowsUnderCapacity(t *testing.T) {
	store := newFakeLeakyBucketStore()
	lim := NewLeakyBucketLimiter(store)
	params := map[string]any{
		"capacity":          5,
		"leak_rate_per_sec": 1.0,
		"water_per_request": 2,
	}

	decision, err := lim.Allow(context.Background(), "p1", "c1", 1700000000000, params)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !decision.Allowed {
		t.Fatalf("expected request allowed")
	}
	if decision.Remaining == nil || *decision.Remaining != 1 {
		t.Fatalf("expected remaining=1, got %+v", decision.Remaining)
	}
}

func TestLeakyBucketRejectsOverCapacity(t *testing.T) {
	store := newFakeLeakyBucketStore()
	lim := NewLeakyBucketLimiter(store)
	params := map[string]any{
		"capacity":          2,
		"leak_rate_per_sec": 1.0,
		"water_per_request": 2,
	}
	now := int64(1700000000000)

	_, _ = lim.Allow(context.Background(), "p1", "c1", now, params)
	blocked, err := lim.Allow(context.Background(), "p1", "c1", now, params)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if blocked.Allowed {
		t.Fatalf("expected second request rejected")
	}
	if blocked.RetryAfterMS == nil || *blocked.RetryAfterMS <= 0 {
		t.Fatalf("expected retry_after_ms > 0")
	}
}

func TestLeakyBucketLeakBehaviorAndBounds(t *testing.T) {
	store := newFakeLeakyBucketStore()
	lim := NewLeakyBucketLimiter(store)
	params := map[string]any{
		"capacity":          3,
		"leak_rate_per_sec": 1.0,
		"water_per_request": 1,
	}
	now := int64(1700000000000)

	_, _ = lim.Allow(context.Background(), "p1", "c1", now, params)
	_, _ = lim.Allow(context.Background(), "p1", "c1", now, params)
	_, _ = lim.Allow(context.Background(), "p1", "c1", now, params)

	afterLeak, err := lim.Allow(context.Background(), "p1", "c1", now+5000, params)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !afterLeak.Allowed {
		t.Fatalf("expected request allowed after leak")
	}
	water, ok := afterLeak.AlgorithmState["water_level"].(float64)
	if !ok {
		t.Fatalf("expected water_level float64")
	}
	if water < 0 || water > 3 {
		t.Fatalf("water_level out of bounds: %v", water)
	}
}

func TestLeakyBucketStateFieldsPresent(t *testing.T) {
	store := newFakeLeakyBucketStore()
	lim := NewLeakyBucketLimiter(store)
	params := map[string]any{
		"capacity":          4,
		"leak_rate_per_sec": 2.0,
	}

	decision, err := lim.Allow(context.Background(), "p1", "c1", 1700000000000, params)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	required := []string{
		"count",
		"window_start_ms",
		"window_size_sec",
		"state_schema_version",
		"water_level",
		"capacity",
		"leak_rate_per_sec",
		"water_per_request",
		"last_leak_ms",
	}
	for _, field := range required {
		if _, ok := decision.AlgorithmState[field]; !ok {
			t.Fatalf("missing algorithm_state field: %s", field)
		}
	}
	if decision.AlgorithmState["state_schema_version"] != 1 {
		t.Fatalf("expected state_schema_version=1")
	}
}
