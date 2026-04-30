package policy

import "testing"

func TestValidateAlgorithmForCurrentPhaseAcceptsSlidingLog(t *testing.T) {
	if err := validateAlgorithmForCurrentPhase("sliding_log"); err != nil {
		t.Fatalf("expected sliding_log to be accepted, got error: %v", err)
	}
}

func TestValidateAlgorithmForCurrentPhaseAcceptsSlidingWindowCounter(t *testing.T) {
	if err := validateAlgorithmForCurrentPhase("sliding_window_counter"); err != nil {
		t.Fatalf("expected sliding_window_counter to be accepted, got error: %v", err)
	}
}

func TestValidateAlgorithmForCurrentPhaseAcceptsTokenBucket(t *testing.T) {
	if err := validateAlgorithmForCurrentPhase("token_bucket"); err != nil {
		t.Fatalf("expected token_bucket to be accepted, got error: %v", err)
	}
}

func TestValidateAlgorithmForCurrentPhaseAcceptsLeakyBucket(t *testing.T) {
	if err := validateAlgorithmForCurrentPhase("leaky_bucket"); err != nil {
		t.Fatalf("expected leaky_bucket to be accepted, got error: %v", err)
	}
}

func TestValidateAlgorithmForCurrentPhaseRejectsUnknownAlgorithm(t *testing.T) {
	if err := validateAlgorithmForCurrentPhase("future_algorithm"); err != ErrUnsupportedInCurrentPhase {
		t.Fatalf("expected ErrUnsupportedInCurrentPhase, got: %v", err)
	}
}

func TestValidateParamsAcceptsSlidingLogSchema(t *testing.T) {
	params, err := validateParams("sliding_log", map[string]any{
		"window_size_sec": 60,
		"limit":           100,
	})
	if err != nil {
		t.Fatalf("expected valid params, got error: %v", err)
	}
	if params["window_size_sec"] != 60 || params["limit"] != 100 {
		t.Fatalf("unexpected normalized params: %+v", params)
	}
}

func TestValidateParamsRejectsSlidingLogMissingLimit(t *testing.T) {
	_, err := validateParams("sliding_log", map[string]any{
		"window_size_sec": 60,
	})
	if err == nil {
		t.Fatalf("expected error for missing limit")
	}
}

func TestValidateParamsAcceptsSlidingWindowCounterSchema(t *testing.T) {
	params, err := validateParams("sliding_window_counter", map[string]any{
		"window_size_sec": 30,
		"limit":           20,
	})
	if err != nil {
		t.Fatalf("expected valid swc params, got error: %v", err)
	}
	if params["window_size_sec"] != 30 || params["limit"] != 20 {
		t.Fatalf("unexpected swc normalized params: %+v", params)
	}
}

func TestValidateParamsAcceptsTokenBucketSchema(t *testing.T) {
	params, err := validateParams("token_bucket", map[string]any{
		"capacity":            20,
		"refill_rate_per_sec": 2.5,
		"tokens_per_request":  3,
	})
	if err != nil {
		t.Fatalf("expected valid token bucket params, got error: %v", err)
	}
	if params["capacity"] != 20 || params["refill_rate_per_sec"] != 2.5 || params["tokens_per_request"] != 3 {
		t.Fatalf("unexpected token bucket normalized params: %+v", params)
	}
}

func TestValidateParamsTokenBucketDefaultsTokensPerRequest(t *testing.T) {
	params, err := validateParams("token_bucket", map[string]any{
		"capacity":            20,
		"refill_rate_per_sec": 2.5,
	})
	if err != nil {
		t.Fatalf("expected valid token bucket params, got error: %v", err)
	}
	if params["tokens_per_request"] != 1 {
		t.Fatalf("expected default tokens_per_request=1, got %+v", params["tokens_per_request"])
	}
}

func TestValidateParamsAcceptsLeakyBucketSchema(t *testing.T) {
	params, err := validateParams("leaky_bucket", map[string]any{
		"capacity":          20,
		"leak_rate_per_sec": 3.5,
		"water_per_request": 2,
	})
	if err != nil {
		t.Fatalf("expected valid leaky bucket params, got error: %v", err)
	}
	if params["capacity"] != 20 || params["leak_rate_per_sec"] != 3.5 || params["water_per_request"] != 2 {
		t.Fatalf("unexpected leaky bucket normalized params: %+v", params)
	}
}

func TestValidateParamsLeakyBucketDefaultsWaterPerRequest(t *testing.T) {
	params, err := validateParams("leaky_bucket", map[string]any{
		"capacity":          20,
		"leak_rate_per_sec": 3.5,
	})
	if err != nil {
		t.Fatalf("expected valid leaky bucket params, got error: %v", err)
	}
	if params["water_per_request"] != 1 {
		t.Fatalf("expected default water_per_request=1, got %+v", params["water_per_request"])
	}
}
