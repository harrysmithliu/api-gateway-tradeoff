package limiter

import (
	"context"
	"fmt"
	"math"
	"testing"
)

type fakeTokenBucketState struct {
	tokens       float64
	lastRefillMS int64
	initialized  bool
}

type fakeTokenBucketStore struct {
	state map[string]fakeTokenBucketState
}

func newFakeTokenBucketStore() *fakeTokenBucketStore {
	return &fakeTokenBucketStore{state: map[string]fakeTokenBucketState{}}
}

func (f *fakeTokenBucketStore) Incr(ctx context.Context, key string) (int64, error) {
	return 0, fmt.Errorf("not used by token bucket tests")
}

func (f *fakeTokenBucketStore) Expire(ctx context.Context, key string, seconds int) error {
	return nil
}

func (f *fakeTokenBucketStore) EvalSlidingLog(ctx context.Context, key string, nowMS int64, windowSizeSec int, limit int, requestToken string) (SlidingLogResult, error) {
	return SlidingLogResult{}, nil
}

func (f *fakeTokenBucketStore) EvalSlidingWindowCounter(ctx context.Context, currentKey string, previousKey string, ttlSec int) (SlidingWindowCounterResult, error) {
	return SlidingWindowCounterResult{}, nil
}

func (f *fakeTokenBucketStore) EvalTokenBucket(ctx context.Context, key string, nowMS int64, capacity int, refillRatePerSec float64, tokensPerRequest int, ttlSec int) (TokenBucketResult, error) {
	st := f.state[key]
	if !st.initialized {
		st.tokens = float64(capacity)
		st.lastRefillMS = nowMS
		st.initialized = true
	}

	elapsed := nowMS - st.lastRefillMS
	if elapsed < 0 {
		elapsed = 0
	}
	st.tokens += (float64(elapsed) / 1000.0) * refillRatePerSec
	if st.tokens > float64(capacity) {
		st.tokens = float64(capacity)
	}

	allowed := false
	retryAfter := 0
	if st.tokens >= float64(tokensPerRequest) {
		allowed = true
		st.tokens -= float64(tokensPerRequest)
	} else {
		need := float64(tokensPerRequest) - st.tokens
		retryAfter = int(math.Ceil((need / refillRatePerSec) * 1000))
		if retryAfter < 1 {
			retryAfter = 1
		}
	}

	st.lastRefillMS = nowMS
	f.state[key] = st
	return TokenBucketResult{
		Allowed:      allowed,
		Tokens:       st.tokens,
		LastRefillMS: st.lastRefillMS,
		RetryAfterMS: retryAfter,
	}, nil
}

func TestTokenBucketAllowsAndConsumesTokens(t *testing.T) {
	store := newFakeTokenBucketStore()
	lim := NewTokenBucketLimiter(store)
	params := map[string]any{
		"capacity":            5,
		"refill_rate_per_sec": 1.0,
		"tokens_per_request":  2,
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

func TestTokenBucketRejectsWhenInsufficientTokens(t *testing.T) {
	store := newFakeTokenBucketStore()
	lim := NewTokenBucketLimiter(store)
	params := map[string]any{
		"capacity":            2,
		"refill_rate_per_sec": 1.0,
		"tokens_per_request":  2,
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
		t.Fatalf("expected retry_after_ms > 0, got %+v", blocked.RetryAfterMS)
	}
}

func TestTokenBucketRefillAndCapacityCap(t *testing.T) {
	store := newFakeTokenBucketStore()
	lim := NewTokenBucketLimiter(store)
	params := map[string]any{
		"capacity":            3,
		"refill_rate_per_sec": 1.0,
		"tokens_per_request":  1,
	}
	now := int64(1700000000000)

	_, _ = lim.Allow(context.Background(), "p1", "c1", now, params)
	_, _ = lim.Allow(context.Background(), "p1", "c1", now, params)
	_, _ = lim.Allow(context.Background(), "p1", "c1", now, params)

	afterRefill, err := lim.Allow(context.Background(), "p1", "c1", now+5000, params)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !afterRefill.Allowed {
		t.Fatalf("expected request allowed after refill")
	}
	tokens, ok := afterRefill.AlgorithmState["tokens"].(float64)
	if !ok {
		t.Fatalf("expected tokens field as float64")
	}
	if tokens > 3.0 {
		t.Fatalf("tokens should not exceed capacity, got %v", tokens)
	}
}

func TestTokenBucketStateFieldsPresent(t *testing.T) {
	store := newFakeTokenBucketStore()
	lim := NewTokenBucketLimiter(store)
	params := map[string]any{
		"capacity":            4,
		"refill_rate_per_sec": 2.0,
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
		"tokens",
		"capacity",
		"refill_rate_per_sec",
		"tokens_per_request",
		"last_refill_ms",
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
