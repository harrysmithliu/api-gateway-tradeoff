# QA Agent Execution Guide (M3 Sliding Window Counter)

## 1. Objective
Validate M3 backend delivery for `sliding_window_counter`:
- policy create/update/activate support is available
- simulation follows SWC behavior
- response contract includes baseline + SWC-specific `algorithm_state` fields
- no regression for existing M1/M2 routes

## 2. Preconditions
- Docker services are running:
  - `postgres`
  - `redis`
  - `gateway`
- Gateway API reachable at `http://localhost:8000`

Quick check:
```bash
curl -sS http://localhost:8000/api/health
```

## 3. Fast Smoke (Recommended)
```bash
cd gateway
chmod +x scripts/qa_smoke_m3_swc.sh
BASE_URL=http://localhost:8000 ./scripts/qa_smoke_m3_swc.sh
```

Expected final line:
```text
[PASS] gateway M3 sliding_window_counter smoke suite
```

## 4. Manual Validation Checklist

### 4.1 Create SWC policy
```bash
curl -i -sS -X POST http://localhost:8000/api/policies \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"qa-manual-swc",
    "algorithm":"sliding_window_counter",
    "params_json":{"window_size_sec":10,"limit":5},
    "enabled":true
  }'
```

Expected:
- HTTP `201`
- `"algorithm":"sliding_window_counter"`

### 4.2 Activate SWC policy
```bash
curl -i -sS -X POST "http://localhost:8000/api/policies/<POLICY_ID>/activate?reset_runtime_state=true"
```

Expected:
- HTTP `200`

### 4.3 Simulate and inspect contract
```bash
curl -i -sS -X POST http://localhost:8000/api/simulate/request \
  -H 'Content-Type: application/json' \
  -d '{"client_id":"qa-manual-swc-client"}'
```

Expected response fields:
- common:
  - `algorithm`
  - `allowed`
  - `remaining`
  - `latency_ms`
  - `algorithm_state`
- in `algorithm_state`:
  - baseline:
    - `count`
    - `window_start_ms`
    - `window_size_sec`
    - `state_schema_version`
  - SWC-specific:
    - `current_window_count`
    - `previous_window_count`
    - `previous_window_weight`
    - `estimated_count`

### 4.4 Negative check for not-yet-supported algorithms
```bash
curl -i -sS -X POST http://localhost:8000/api/policies \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"qa-token-unsupported",
    "algorithm":"token_bucket",
    "params_json":{"capacity":10,"refill_rate_per_sec":1},
    "enabled":true
  }'
```

Expected:
- HTTP `422`

## 5. Regression Checks
```bash
cd gateway
docker run --rm -v "$PWD":/src -w /src golang:1.24 sh -lc 'export PATH=$PATH:/usr/local/go/bin && go test ./...'
```

Expected:
- fixed window tests pass
- sliding log tests pass
- SWC tests pass
- API integration tests pass

## 6. Report Template
When QA finishes, report:
- image/tag used
- smoke result (`PASS/FAIL`)
- manual checklist pass/fail
- contract mismatches (if any)
- regression test summary
