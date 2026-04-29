# Backend QA Handoff Guide

Last updated: 2026-04-29

## 1. Scope
This guide enables QA-agent to validate the backend delivery for:
- Policy management
- Active policy switching
- Runtime reset on activation
- Request simulation (`/simulate/request`, `/simulate/burst`)
- Metrics APIs (`/metrics/summary`, `/metrics/timeseries`)
- Logs API (`/logs` with cursor pagination and `rejected_only` filtering)
- Run management (`/runs` create/complete/list)
- Run-aware simulation validation (`run_id` must exist and be `running`)

## 2. Environment Preconditions
- Docker services are up and healthy:
  - postgres
  - redis
  - backend
  - frontend (optional for API validation)
- Backend API base URL: `http://localhost:8000/api`
- Database migration is applied (`alembic_version = c85b184f6e9a`)

Recommended quick checks:
```bash
curl -sS http://localhost:8000/api/health
curl -sS http://localhost:8000/
```

## 3. Stable API Contract Summary
- `GET /policies`
- `POST /policies`
- `PUT /policies/{policy_id}`
- `POST /policies/{policy_id}/activate?reset_runtime_state=true|false`
- `GET /policies/active`

- `POST /simulate/request`
- `POST /simulate/burst`

- `GET /metrics/summary?window_sec=60&run_id=<optional>`
- `GET /metrics/timeseries?window_sec=120&step_sec=1&run_id=<optional>`

- `GET /logs?cursor=0&limit=200&run_id=<optional>&rejected_only=true|false`

- `POST /runs`
- `POST /runs/{id}/complete`
- `GET /runs`

## 4. Test Matrix

### 4.1 Policy CRUD + Activation
1. Create a valid policy (`token_bucket` or `fixed_window`).
- Expect: `201`, `version=1`.
2. Create another policy with duplicate `name`.
- Expect: `409`.
3. Update existing policy params.
- Expect: `200`, `version` incremented.
4. Activate enabled policy.
- Expect: `200`, `GET /policies/active` matches activated policy.
5. Activate disabled policy.
- Expect: `409`.

### 4.2 Runtime Reset Verification
Use fixed window to make behavior deterministic.
1. Create and activate policy: `window_size_sec=60`, `limit=1`.
2. Call `/simulate/request` twice with same `client_id`.
- Expect: first `200`, second `429`.
3. Call activation on same policy with `reset_runtime_state=true`.
4. Call `/simulate/request` again with same `client_id`.
- Expect: `200` (counter state cleared).

### 4.3 Simulation Decision Contract
1. `/simulate/request` with valid `client_id`.
- Expect fields:
  - `request_id`
  - `ts`
  - `policy_id`
  - `algorithm`
  - `allowed`
  - `reason`
  - `retry_after_ms`
  - `latency_ms`
2. Blank `client_id`.
- Expect: `422`.
3. For reject path, expect HTTP `429` and `reason=rate_limit_exceeded`.

### 4.4 Burst Simulation
1. Call `/simulate/burst` with `total_requests > limit` under fixed window.
- Expect:
  - `total` equals request count
  - `allowed + rejected == total`
  - each decision entry has the decision contract fields

### 4.5 Run Management + Run-Aware Simulation
1. `POST /runs` with valid `policy_id`.
- Expect: `201`, `status=running`, `ended_at=null`.
2. Call `/simulate/request` with this `run_id`.
- Expect: accepted normal decision (`200` or `429` depending on limiter state).
3. Complete run with `POST /runs/{id}/complete` (`completed` or `failed`).
- Expect: `200`, `status` updated, `ended_at` populated.
4. Call `/simulate/request` again with completed `run_id`.
- Expect: `409` (`Run is not in running state.`).
5. `GET /runs` contains created run.

### 4.6 Metrics API
1. Generate traffic via `/simulate/burst`.
2. Call `/metrics/summary?window_sec=120`.
- Expect non-negative fields:
  - `total`, `allowed`, `rejected`
  - `accept_rate`, `reject_rate`, `qps`
  - `p50`, `p95`, `p99`
  - `peak_qps`
3. Call `/metrics/timeseries?window_sec=120&step_sec=1`.
- Expect array of points with:
  - `ts`, `qps`, `allowed`, `rejected`, `reject_rate`, `p99_ms`, `peak_delta`
4. Repeat metrics checks with `run_id` query.
- Expect run-scoped metrics consistent with run traffic.

### 4.7 Logs API
1. Generate mixed allow/reject traffic.
2. `GET /logs?cursor=0&limit=3`.
- Expect:
  - `items` length `<= limit`
  - `next_cursor` advances.
3. Fetch next page with returned cursor.
- Expect pagination continuity.
4. `GET /logs?...&rejected_only=true`.
- Expect all items `allowed=false`.
5. Paginate rejected-only pages until empty page.
- Expect no rejected item loss across pages.

## 5. Regression Focus Areas
- Activation should not break active policy retrieval.
- Reset must only clear runtime limiter keys for the target policy and not crash concurrent requests.
- Metrics/logs must continue to be written for both `run_id` and global scopes.
- `simulate/request` and `simulate/burst` should remain backward-compatible for required fields.

## 6. Failure Triage Hints
- If all DB-backed APIs fail: check Postgres connectivity and migration version.
- If simulation fails while policy APIs pass: check Redis connectivity.
- If metrics/logs appear empty: verify simulation requests were sent after backend startup and query window is wide enough.
- If run-scoped requests fail unexpectedly: verify run exists and status is `running`.

## 7. QA Exit Criteria
Backend can be considered ready for integration QA when all below are true:
- Policy CRUD/activate flows pass.
- Runtime reset scenario passes.
- Simulation contract and status code behavior pass.
- Burst, metrics, logs, and run APIs pass.
- Rejected-only log pagination shows no loss across pages.
