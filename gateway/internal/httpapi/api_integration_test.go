package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"gateway/internal/config"
	"gateway/internal/policy"
	"gateway/internal/proxy"
	"gateway/internal/simulate"
)

type fakePolicyManager struct {
	item policy.Policy
}

func newFakePolicyManager() *fakePolicyManager {
	now := time.Now().UTC()
	return &fakePolicyManager{
		item: policy.Policy{
			ID:         "00000000-0000-0000-0000-000000000001",
			Name:       "fixed-default",
			Algorithm:  "fixed_window",
			ParamsJSON: map[string]any{"window_size_sec": 60, "limit": 10},
			Enabled:    true,
			Version:    1,
			CreatedAt:  now,
			UpdatedAt:  now,
		},
	}
}

func (f *fakePolicyManager) List(ctx context.Context) ([]policy.Policy, error) {
	return []policy.Policy{f.item}, nil
}

func (f *fakePolicyManager) Create(ctx context.Context, req policy.CreateRequest) (policy.Policy, error) {
	now := time.Now().UTC()
	f.item = policy.Policy{
		ID:          "00000000-0000-0000-0000-000000000002",
		Name:        req.Name,
		Algorithm:   req.Algorithm,
		ParamsJSON:  req.ParamsJSON,
		Enabled:     req.Enabled,
		Version:     1,
		Description: req.Description,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	return f.item, nil
}

func (f *fakePolicyManager) Update(ctx context.Context, id string, req policy.UpdateRequest) (policy.Policy, error) {
	f.item.Version++
	if req.ParamsJSON != nil {
		f.item.ParamsJSON = *req.ParamsJSON
	}
	f.item.UpdatedAt = time.Now().UTC()
	return f.item, nil
}

func (f *fakePolicyManager) Activate(ctx context.Context, id string, resetRuntime bool) (policy.Policy, error) {
	return f.item, nil
}

func (f *fakePolicyManager) Active(ctx context.Context) (policy.Policy, error) {
	return f.item, nil
}

type fakeSimulator struct {
	allow bool
}

func (f fakeSimulator) Evaluate(ctx context.Context, clientID string) (simulate.Response, error) {
	now := time.Now().UTC()
	if f.allow {
		remaining := 3
		return simulate.Response{
			RequestID: "req-1",
			TS:        now,
			PolicyID:  "pid-1",
			Algorithm: "fixed_window",
			Allowed:   true,
			LatencyMS: 1,
			Remaining: &remaining,
		}, nil
	}
	reason := "rate_limit_exceeded"
	retry := 100
	zero := 0
	return simulate.Response{
		RequestID:    "req-2",
		TS:           now,
		PolicyID:     "pid-1",
		Algorithm:    "fixed_window",
		Allowed:      false,
		LatencyMS:    1,
		Reason:       &reason,
		RetryAfterMS: &retry,
		Remaining:    &zero,
	}, nil
}

type scriptedSimulator struct {
	mu        sync.Mutex
	responses []simulate.Response
	index     int
}

func (s *scriptedSimulator) Evaluate(ctx context.Context, clientID string) (simulate.Response, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.responses) == 0 {
		return simulate.Response{}, nil
	}
	if s.index >= len(s.responses) {
		return s.responses[len(s.responses)-1], nil
	}
	resp := s.responses[s.index]
	s.index++
	return resp, nil
}

func newTestServer(sim Simulator, policies PolicyManager) http.Handler {
	cfg := config.Config{AppName: "test", Environment: "test", CorsAllowedOrigins: []string{"*"}}
	proxySvc := proxy.NewService(config.Config{
		UserServiceURL:    "http://localhost:8001",
		ProductServiceURL: "http://localhost:8002",
		OrderServiceURL:   "http://localhost:8003",
	})
	return NewWithDeps(cfg, nil, nil, policies, sim, proxySvc).Router()
}

func TestSimulateRequestAllowedReturns200(t *testing.T) {
	h := newTestServer(fakeSimulator{allow: true}, newFakePolicyManager())

	req := httptest.NewRequest(http.MethodPost, "/api/simulate/request", bytes.NewBufferString(`{"client_id":"c1"}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.Code)
	}
}

func TestSimulateRequestRejectedReturns429(t *testing.T) {
	h := newTestServer(fakeSimulator{allow: false}, newFakePolicyManager())

	req := httptest.NewRequest(http.MethodPost, "/api/simulate/request", bytes.NewBufferString(`{"client_id":"c1"}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)

	if res.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", res.Code)
	}
}

func TestPolicyLifecycleRoutes(t *testing.T) {
	pm := newFakePolicyManager()
	h := newTestServer(fakeSimulator{allow: true}, pm)

	create := httptest.NewRequest(http.MethodPost, "/api/policies", bytes.NewBufferString(`{"name":"p1","algorithm":"fixed_window","params_json":{"window_size_sec":60,"limit":5},"enabled":true}`))
	create.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	h.ServeHTTP(createRes, create)
	if createRes.Code != http.StatusCreated {
		t.Fatalf("create expected 201 got %d", createRes.Code)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/policies", nil)
	listRes := httptest.NewRecorder()
	h.ServeHTTP(listRes, listReq)
	if listRes.Code != http.StatusOK {
		t.Fatalf("list expected 200 got %d", listRes.Code)
	}

	var listPayload []map[string]any
	if err := json.Unmarshal(listRes.Body.Bytes(), &listPayload); err != nil {
		t.Fatalf("list payload parse failed: %v", err)
	}
	if len(listPayload) != 1 {
		t.Fatalf("expected one policy")
	}

	updateReq := httptest.NewRequest(http.MethodPut, "/api/policies/00000000-0000-0000-0000-000000000002", bytes.NewBufferString(`{"params_json":{"window_size_sec":120,"limit":8}}`))
	updateReq.Header.Set("Content-Type", "application/json")
	updateRes := httptest.NewRecorder()
	h.ServeHTTP(updateRes, updateReq)
	if updateRes.Code != http.StatusOK {
		t.Fatalf("update expected 200 got %d", updateRes.Code)
	}

	activateReq := httptest.NewRequest(http.MethodPost, "/api/policies/00000000-0000-0000-0000-000000000002/activate?reset_runtime_state=true", nil)
	activateRes := httptest.NewRecorder()
	h.ServeHTTP(activateRes, activateReq)
	if activateRes.Code != http.StatusOK {
		t.Fatalf("activate expected 200 got %d", activateRes.Code)
	}

	activeReq := httptest.NewRequest(http.MethodGet, "/api/policies/active", nil)
	activeRes := httptest.NewRecorder()
	h.ServeHTTP(activeRes, activeReq)
	if activeRes.Code != http.StatusOK {
		t.Fatalf("active expected 200 got %d", activeRes.Code)
	}
}

func TestSlidingLogPolicyAndSimulateProgression(t *testing.T) {
	pm := newFakePolicyManager()
	now := time.Now().UTC()
	reason := "rate_limit_exceeded"
	retry := 800
	two := 2
	one := 1
	zero := 0

	sim := &scriptedSimulator{
		responses: []simulate.Response{
			{
				RequestID: "req-allow-1",
				TS:        now,
				PolicyID:  "pid-sl-1",
				Algorithm: "sliding_log",
				Allowed:   true,
				LatencyMS: 1,
				Remaining: &two,
			},
			{
				RequestID: "req-allow-2",
				TS:        now.Add(10 * time.Millisecond),
				PolicyID:  "pid-sl-1",
				Algorithm: "sliding_log",
				Allowed:   true,
				LatencyMS: 1,
				Remaining: &one,
			},
			{
				RequestID:    "req-blocked",
				TS:           now.Add(20 * time.Millisecond),
				PolicyID:     "pid-sl-1",
				Algorithm:    "sliding_log",
				Allowed:      false,
				LatencyMS:    1,
				Reason:       &reason,
				RetryAfterMS: &retry,
				Remaining:    &zero,
			},
		},
	}
	h := newTestServer(sim, pm)

	create := httptest.NewRequest(http.MethodPost, "/api/policies", bytes.NewBufferString(`{"name":"sliding-p1","algorithm":"sliding_log","params_json":{"window_size_sec":60,"limit":3},"enabled":true}`))
	create.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	h.ServeHTTP(createRes, create)
	if createRes.Code != http.StatusCreated {
		t.Fatalf("create expected 201 got %d", createRes.Code)
	}

	var created map[string]any
	if err := json.Unmarshal(createRes.Body.Bytes(), &created); err != nil {
		t.Fatalf("create payload parse failed: %v", err)
	}
	if created["algorithm"] != "sliding_log" {
		t.Fatalf("expected created algorithm sliding_log, got %v", created["algorithm"])
	}

	activateReq := httptest.NewRequest(http.MethodPost, "/api/policies/00000000-0000-0000-0000-000000000002/activate", nil)
	activateRes := httptest.NewRecorder()
	h.ServeHTTP(activateRes, activateReq)
	if activateRes.Code != http.StatusOK {
		t.Fatalf("activate expected 200 got %d", activateRes.Code)
	}

	callSimulate := func() (int, map[string]any) {
		req := httptest.NewRequest(http.MethodPost, "/api/simulate/request", bytes.NewBufferString(`{"client_id":"client-a"}`))
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		h.ServeHTTP(res, req)
		var payload map[string]any
		_ = json.Unmarshal(res.Body.Bytes(), &payload)
		return res.Code, payload
	}

	code1, payload1 := callSimulate()
	code2, payload2 := callSimulate()
	code3, payload3 := callSimulate()

	if code1 != http.StatusOK || code2 != http.StatusOK || code3 != http.StatusTooManyRequests {
		t.Fatalf("expected status progression 200,200,429 got %d,%d,%d", code1, code2, code3)
	}
	if payload1["algorithm"] != "sliding_log" || payload2["algorithm"] != "sliding_log" || payload3["algorithm"] != "sliding_log" {
		t.Fatalf("expected sliding_log algorithm in all simulate responses")
	}
}
