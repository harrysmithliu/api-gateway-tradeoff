# QA Agent Execution Guide (M4 Token Bucket)

## 1. Objective
Validate M4 backend delivery for `token_bucket`:
- policy create/update/activate supports token bucket parameters
- simulation enforces token bucket allow/reject/refill behavior
- response contract includes baseline + token-bucket-specific `algorithm_state`
- no regression for M1/M2/M3 paths

## 2. Preconditions
- Docker services running:
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
chmod +x scripts/qa_smoke_m4_token_bucket.sh
BASE_URL=http://localhost:8000 ./scripts/qa_smoke_m4_token_bucket.sh
```

Expected final line:
```text
[PASS] gateway M4 token_bucket smoke suite
```

## 4. Manual Validation Checklist

### 4.1 Create token-bucket policy
```bash
curl -i -sS -X POST http://localhost:8000/api/policies \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"qa-manual-token-bucket",
    "algorithm":"token_bucket",
    "params_json":{"capacity":10,"refill_rate_per_sec":2.5,"tokens_per_request":2},
    "enabled":true
  }'
```

Expected:
- HTTP `201`
- `"algorithm":"token_bucket"`

### 4.2 Activate policy
```bash
curl -i -sS -X POST "http://localhost:8000/api/policies/<POLICY_ID>/activate?reset_runtime_state=true"
```

Expected:
- HTTP `200`

### 4.3 Simulate and inspect contract
```bash
curl -i -sS -X POST http://localhost:8000/api/simulate/request \
  -H 'Content-Type: application/json' \
  -d '{"client_id":"qa-manual-tb-client"}'
```

Expected response:
- common fields:
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
  - token-bucket-specific:
    - `tokens`
    - `capacity`
    - `refill_rate_per_sec`
    - `tokens_per_request`
    - `last_refill_ms`

### 4.4 Behavior spot-check
- Send a short burst with one client.
- Expect at least one `429` once tokens are exhausted.
- Wait for refill duration and verify requests become `200` again.

### 4.5 Negative check for unsupported algorithm
```bash
curl -i -sS -X POST http://localhost:8000/api/policies \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"qa-leaky-unsupported",
    "algorithm":"leaky_bucket",
    "params_json":{"capacity":10,"leak_rate_per_sec":1},
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
- sliding window counter tests pass
- token bucket tests pass
- API integration tests pass

## 6. Report Template
When QA finishes, report:
- image/tag used
- smoke result (`PASS/FAIL`)
- manual checklist pass/fail
- behavior mismatches (if any)
- regression test summary
