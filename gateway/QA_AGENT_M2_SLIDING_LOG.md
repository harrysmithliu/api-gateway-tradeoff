# QA Agent Execution Guide (M2 Sliding Log)

## 1. Objective
Validate M2 backend delivery for `sliding_log` in the Go gateway:
- policy create/update/activate accepts `sliding_log`
- simulation enforces sliding log allow/reject progression
- fixed window path is not regressed

## 2. Preconditions
- Docker services are running and healthy:
  - `postgres`
  - `redis`
  - `gateway`
- Gateway API reachable at `http://localhost:8000`

Quick check:
```bash
curl -sS http://localhost:8000/api/health
```

Expected: HTTP `200`, body contains `"status":"ok"` or `"status":"degraded"` with service details.

## 3. Fast Smoke (Recommended)
Run the scripted M2 smoke:

```bash
cd gateway
chmod +x scripts/qa_smoke_m2_sliding_log.sh
BASE_URL=http://localhost:8000 ./scripts/qa_smoke_m2_sliding_log.sh
```

Expected final line:
```text
[PASS] gateway M2 sliding_log smoke suite
```

## 4. Manual Validation Checklist

### 4.1 Create `sliding_log` policy
Request:
```bash
curl -i -sS -X POST http://localhost:8000/api/policies \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"qa-manual-sliding-log",
    "algorithm":"sliding_log",
    "params_json":{"window_size_sec":3,"limit":2},
    "enabled":true
  }'
```

Expected:
- HTTP `201`
- JSON includes `"algorithm":"sliding_log"`

### 4.2 Activate policy
```bash
curl -i -sS -X POST "http://localhost:8000/api/policies/<POLICY_ID>/activate?reset_runtime_state=true"
```

Expected:
- HTTP `200`

### 4.3 Simulate progression
Run same client repeatedly:
```bash
curl -i -sS -X POST http://localhost:8000/api/simulate/request \
  -H 'Content-Type: application/json' \
  -d '{"client_id":"qa-manual-client"}'
```

Expected progression with `window_size_sec=3, limit=2`:
- 1st request: HTTP `200`, `allowed=true`
- 2nd request: HTTP `200`, `allowed=true`
- 3rd immediate request: HTTP `429`, `allowed=false`, `reason=rate_limit_exceeded`, `retry_after_ms>0`
- after waiting >= 3 seconds: request becomes HTTP `200` again

### 4.4 Negative policy validation
Unsupported algorithm should still fail:
```bash
curl -i -sS -X POST http://localhost:8000/api/policies \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"qa-unsupported",
    "algorithm":"token_bucket",
    "params_json":{"capacity":10,"refill_rate_per_sec":1},
    "enabled":true
  }'
```

Expected:
- HTTP `422`

## 5. Regression Checks
Run Go tests:
```bash
cd gateway
docker run --rm -v "$PWD":/src -w /src golang:1.24 sh -lc 'export PATH=$PATH:/usr/local/go/bin && go test ./...'
```

Expected:
- limiter tests pass (including fixed window and sliding log)
- API integration tests pass

## 6. Consistency Failure-Path Check (Required)
Validate `activate + reset_runtime_state` deterministic behavior when reset fails:

```bash
cd gateway
chmod +x scripts/qa_activate_reset_consistency_m2.sh
BASE_URL=http://localhost:8000 ./scripts/qa_activate_reset_consistency_m2.sh
```

Expected final line:
```text
[PASS] activate+reset consistency failure-path check
```

This script intentionally stops redis, attempts activation with reset (expects HTTP 500), then verifies active policy did not switch.

## 7. Report Template
When QA finishes, report:
- environment and gateway image/tag
- smoke result (`PASS/FAIL`)
- manual checklist pass/fail items
- consistency failure-path result (`PASS/FAIL`)
- any payloads/status mismatches (include request/response excerpts)
- regression test output summary
