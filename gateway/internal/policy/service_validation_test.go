package policy

import "testing"

func TestValidateAlgorithmForCurrentPhaseAcceptsSlidingLog(t *testing.T) {
	if err := validateAlgorithmForCurrentPhase("sliding_log"); err != nil {
		t.Fatalf("expected sliding_log to be accepted, got error: %v", err)
	}
}

func TestValidateAlgorithmForCurrentPhaseRejectsFutureAlgorithm(t *testing.T) {
	if err := validateAlgorithmForCurrentPhase("token_bucket"); err != ErrUnsupportedInCurrentPhase {
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
