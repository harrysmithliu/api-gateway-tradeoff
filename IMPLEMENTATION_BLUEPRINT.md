# API Gateway Rate Limiter Simulator - Implementation Blueprint

## 1. Document Objective
This blueprint defines an "industry-style minimum runnable" rate-limiting simulation system with:
- A Python backend that supports hot-switching across 5 rate limiter algorithms
- Redis as runtime state storage for limiter counters/tokens/windows
- PostgreSQL as policy and parameter storage
- A React frontend for request simulation, policy switching, metrics, and logs visualization
- One-command deployment through Docker Compose

This file is intended for another agent to implement with minimal ambiguity.

---

## 2. Scope and Principles

### 2.1 In Scope
- Algorithms: `Fixed Window`, `Sliding Log`, `Sliding Window Counter`, `Token Bucket`, `Leaky Bucket`
- Policy management: create, update, enable/disable, activate policy
- Request simulation: frontend sends burst/round requests to backend
- Real-time visualization: throughput, rejection rate, latency percentiles (including P99), peak behavior
- Log display: per-request logs (allow/reject, reason, retry_after, etc.)
- Containerized deployment: `api + frontend + redis + postgres`

### 2.2 Out of Scope (v1)
- Authentication and authorization
- Multi-node distributed consistency optimization
- Long-term historical analytics warehouse
- Advanced alerting/notification pipelines

### 2.3 Key Design Principles
- End-to-end runnable flow over complexity
- Config/runtime separation: PostgreSQL for policies, Redis for runtime state
- Unified limiter interface for easy replacement and extension
- Frontend "single-panel comparison" first for algorithm behavior clarity

---

## 3. High-Level Architecture

```text
┌────────────────────┐
│ React + Vite UI    │
│ - Policy controls  │
│ - Request simulator│
│ - Metrics + logs   │
└─────────┬──────────┘
          │ HTTP Polling
┌─────────▼──────────┐
│ FastAPI Service     │
│ - Policy API        │
│ - Simulation API    │
│ - Metrics API       │
│ - 5 Limiter Engines │
└──────┬────────┬────┘
       │        │
┌──────▼───┐ ┌──▼──────────┐
│ Redis    │ │ PostgreSQL   │
│ Runtime  │ │ Policies     │
│ State    │ │ + Params     │
└──────────┘ └─────────────┘
```

---

## 4. Technology Stack
- Backend: `FastAPI`, `Uvicorn`, `Pydantic`, `SQLAlchemy`, `Alembic`, `redis-py`
- Frontend: `React`, `Vite`, `TypeScript`, `ECharts`
- Infrastructure: `Docker`, `Docker Compose`
- Optional testing: `pytest`, `httpx`

---

## 5. Data Model (PostgreSQL)

Use Alembic migrations. Use `JSONB` for algorithm parameter payloads.

### 5.1 Table: `rate_limit_policies`
- `id` UUID PK
- `name` VARCHAR(128) UNIQUE NOT NULL
- `algorithm` VARCHAR(32) NOT NULL
  - enum: `fixed_window | sliding_log | sliding_window_counter | token_bucket | leaky_bucket`
- `params_json` JSONB NOT NULL
- `enabled` BOOLEAN NOT NULL DEFAULT TRUE
- `version` INT NOT NULL DEFAULT 1
- `description` TEXT NULL
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()
- `updated_at` TIMESTAMPTZ NOT NULL DEFAULT now()

Constraints:
- `algorithm` must be within supported enum values
- `params_json` is validated by application-layer schema per algorithm

### 5.2 Table: `active_policy`
- `id` SMALLINT PK DEFAULT 1 (single-row control table)
- `policy_id` UUID NOT NULL REFERENCES `rate_limit_policies(id)`
- `updated_at` TIMESTAMPTZ NOT NULL DEFAULT now()

Constraints:
- Exactly one active row at all times (enforced by service logic)

### 5.3 Table: `experiment_runs` (recommended)
- `id` UUID PK
- `name` VARCHAR(128) NOT NULL
- `policy_id` UUID NOT NULL REFERENCES `rate_limit_policies(id)`
- `scenario_json` JSONB NOT NULL (round/burst config snapshot)
- `started_at` TIMESTAMPTZ NOT NULL
- `ended_at` TIMESTAMPTZ NULL
- `status` VARCHAR(16) NOT NULL (`running|completed|failed`)

### 5.4 Table: `request_logs` (optional for v1)
v1 may keep logs in Redis/in-memory ring buffer. If persisted:
- `id` BIGSERIAL PK
- `ts` TIMESTAMPTZ NOT NULL
- `run_id` UUID NULL
- `request_id` VARCHAR(64) NOT NULL
- `client_id` VARCHAR(64) NOT NULL
- `policy_id` UUID NOT NULL
- `algorithm` VARCHAR(32) NOT NULL
- `allowed` BOOLEAN NOT NULL
- `reason` VARCHAR(64) NULL
- `latency_ms` INT NOT NULL
- `retry_after_ms` INT NULL

---

## 6. Redis Key Design

Naming convention: `rl:{algorithm}:{policy_id}:{client_id}:...`

### 6.1 Fixed Window
- Key: `rl:fixed_window:{policy_id}:{client_id}:{window_start}`
- Value: counter via `INCR`
- TTL: `window_size_sec + 1`

### 6.2 Sliding Log
- Key: `rl:sliding_log:{policy_id}:{client_id}`
- Type: ZSET (`score=timestamp_ms`, `member=request_id`)
- Ops: `ZADD`, `ZREMRANGEBYSCORE`, `ZCARD`

### 6.3 Sliding Window Counter
- Keys:
  - `rl:swc:{policy_id}:{client_id}:curr:{window_start}`
  - `rl:swc:{policy_id}:{client_id}:prev:{window_start-prev}`
- Logic: current-window count + weighted previous-window count

### 6.4 Token Bucket
- Hash key: `rl:token:{policy_id}:{client_id}`
- Fields:
  - `tokens` (float)
  - `last_refill_ms` (int)

### 6.5 Leaky Bucket
- Hash key: `rl:leaky:{policy_id}:{client_id}`
- Fields:
  - `water_level` (float)
  - `last_leak_ms` (int)

### 6.6 Metrics and Log Caching
- Per-second metrics bucket (recommended):
  - `metrics:{run_or_global}:{epoch_sec}` -> hash
  - fields: `total`, `allowed`, `rejected`, `latency_sum_ms`, optional `latency_samples_json`
- Log stream:
  - `logs:{run_or_global}` -> Redis Stream or bounded List

---

## 7. Algorithm Interface and Decision Contract

### 7.1 Unified Interface
```python
class Decision(BaseModel):
    allowed: bool
    reason: str | None
    remaining: int | None
    retry_after_ms: int | None
    algorithm_state: dict | None

class RateLimiter(Protocol):
    async def allow(
        self,
        policy_id: str,
        client_id: str,
        now_ms: int,
        params: dict
    ) -> Decision: ...
```

### 7.2 Parameter Schema (minimum)
- `fixed_window`
  - `window_size_sec` (int > 0)
  - `limit` (int > 0)
- `sliding_log`
  - `window_size_sec` (int > 0)
  - `limit` (int > 0)
- `sliding_window_counter`
  - `window_size_sec` (int > 0)
  - `limit` (int > 0)
- `token_bucket`
  - `capacity` (int > 0)
  - `refill_rate_per_sec` (float > 0)
  - `tokens_per_request` (int > 0, default 1)
- `leaky_bucket`
  - `capacity` (int > 0)
  - `leak_rate_per_sec` (float > 0)
  - `water_per_request` (int > 0, default 1)

### 7.3 Allow/Reject Behavior
- `allowed=true` => HTTP 200
- `allowed=false` => HTTP 429
- Unified response fields:
  - `request_id`, `ts`, `policy_id`, `algorithm`, `allowed`, `reason`, `retry_after_ms`, `latency_ms`

---

## 8. Backend API Contract (FastAPI)

Base path: `/api`

### 8.1 Policy Management
1. `GET /api/policies`
- List all policies

2. `POST /api/policies`
- Create policy
- Body:
```json
{
  "name": "token-default",
  "algorithm": "token_bucket",
  "params_json": {
    "capacity": 100,
    "refill_rate_per_sec": 50,
    "tokens_per_request": 1
  },
  "enabled": true,
  "description": "default token bucket"
}
```

3. `PUT /api/policies/{policy_id}`
- Update policy params (`version += 1`)

4. `POST /api/policies/{policy_id}/activate`
- Set policy as active
- Optional query: `reset_runtime_state=true|false`

5. `GET /api/policies/active`
- Get currently active policy

### 8.2 Simulation APIs
1. `POST /api/simulate/request`
- Body:
```json
{
  "client_id": "client-a",
  "run_id": "optional-uuid"
}
```
- Response:
```json
{
  "request_id": "uuid",
  "ts": "2026-04-29T15:00:00Z",
  "policy_id": "uuid",
  "algorithm": "fixed_window",
  "allowed": false,
  "reason": "rate_limit_exceeded",
  "retry_after_ms": 320,
  "latency_ms": 4
}
```

2. `POST /api/simulate/burst` (optional)
- Backend executes one configured burst to simplify scripted demos

### 8.3 Metrics and Logs APIs
1. `GET /api/metrics/summary?window_sec=60&run_id=...`
- Aggregated window metrics:
  - `total`, `allowed`, `rejected`, `accept_rate`, `reject_rate`, `qps`, `p50`, `p95`, `p99`, `peak_qps`

2. `GET /api/metrics/timeseries?window_sec=120&step_sec=1&run_id=...`
- Time-series points:
```json
[
  {
    "ts": 1714400000,
    "qps": 120,
    "allowed": 100,
    "rejected": 20,
    "reject_rate": 0.1667,
    "p99_ms": 18,
    "peak_delta": 35
  }
]
```

3. `GET /api/logs?cursor=...&limit=200&run_id=...`
- Incremental log polling
- Returns `next_cursor`

### 8.4 Run Management (recommended)
1. `POST /api/runs`
2. `POST /api/runs/{id}/complete`
3. `GET /api/runs`

---

## 9. Frontend Page Specification (React + Vite + ECharts)

Single dashboard page with 5 sections.

### 9.1 Policy Control Section
- Policy dropdown (`/policies`)
- Active policy display (`/policies/active`)
- Dynamic params form (changes by algorithm)
- Actions:
  - `Save Policy`
  - `Activate Policy`
  - `Activate + Reset Runtime State`

### 9.2 Request Simulation Section
- Inputs:
  - `rounds`
  - `requests_per_round`
  - `round_interval_ms`
  - `concurrency`
  - `client_id_mode` (`single` / `rotating`)
- Controls:
  - `Start`
  - `Pause`
  - `Stop`
  - `Reset Charts`

Simulation behavior:
- Frontend sends timed `POST /simulate/request`
- Concurrency controlled by Promise pool

### 9.3 Realtime KPI Cards
- `Total Requests`
- `Allowed`
- `Rejected`
- `Reject Rate`
- `Current QPS`
- `Peak QPS`
- `P50 / P95 / P99 latency`

### 9.4 Single-Panel Comparison Chart (priority)
Goal: compare key metrics in one panel.

- Chart type: ECharts multi-Y line chart
- X-axis: time (seconds)
- Left Y-axis: `QPS`, `Reject Rate`
- Right Y-axis: `P99 latency(ms)`
- Series:
  - Single-policy live mode: `qps`, `reject_rate`, `p99`
  - Multi-run compare mode (optional): `runA_qps`, `runB_qps`, `runA_p99`, `runB_p99`

Required features:
- Legend-based series toggles
- Time window switch: `60s / 120s / 300s`
- Auto refresh every `1s`

### 9.5 Logs Section
- Table columns:
  - `time`, `request_id`, `client_id`, `policy`, `algorithm`, `allowed`, `reason`, `retry_after_ms`, `latency_ms`
- Features:
  - `Rejected Only` filter
  - Clear table view
  - Auto-scroll to bottom

---

## 10. Metrics Definitions

### 10.1 Core Metrics
- `QPS = total requests in current second`
- `Reject Rate = rejected / total`
- `Accept Rate = allowed / total`

### 10.2 Latency Percentiles
- Data source: per-request `latency_ms`
- Window: most recent `window_sec`
- Percentiles:
  - `P50`
  - `P95`
  - `P99`

v1 approach:
- Store per-second latency samples with bounded sample count
- Merge samples over selected window and compute percentiles

### 10.3 Peak Change
- `peak_qps`: maximum qps in the selected window
- `peak_delta`: `qps[t] - qps[t-1]`

---

## 11. Recommended Project Structure

```text
api-gateway-tradeoff/
  backend/
    app/
      main.py
      core/
        config.py
        db.py
        redis.py
      models/
        policy.py
        run.py
      schemas/
        policy.py
        simulate.py
        metrics.py
      limiters/
        base.py
        fixed_window.py
        sliding_log.py
        sliding_window_counter.py
        token_bucket.py
        leaky_bucket.py
        factory.py
      services/
        policy_service.py
        limiter_service.py
        metrics_service.py
        log_service.py
      api/
        policy_routes.py
        simulate_routes.py
        metrics_routes.py
        run_routes.py
    alembic/
    requirements.txt
    Dockerfile
  frontend/
    src/
      api/
      components/
        PolicyPanel.tsx
        SimulationPanel.tsx
        KpiCards.tsx
        ComparisonChart.tsx
        LogTable.tsx
      pages/
        Dashboard.tsx
      types/
      App.tsx
      main.tsx
    package.json
    Dockerfile
  infra/
    docker-compose.yml
  README.md
```

---

## 12. Docker Compose Requirements

Services:
- `postgres`
  - image: `postgres:16`
  - optional SQL init mount
  - healthcheck: `pg_isready`
- `redis`
  - image: `redis:7`
  - healthcheck: `redis-cli ping`
- `backend`
  - build: `./backend`
  - depends on `postgres`, `redis`
  - expose port `8000`
  - run migrations before app start
- `frontend`
  - build: `./frontend`
  - expose port `5173` (or serve via Nginx on `80`)
  - configured with backend API base URL

Backend env vars:
- `POSTGRES_DSN`
- `REDIS_URL`
- `API_PORT`
- `LOG_LEVEL`

---

## 13. Milestones and Acceptance Criteria

### M1 - Infrastructure and Skeleton
Deliverables:
- Full folder structure
- Dockerfiles + docker-compose
- Empty but runnable FastAPI/React skeleton
Acceptance:
- `docker compose up` brings up all 4 healthy services

### M2 - Policy Management and Hot Switch
Deliverables:
- Postgres schema + Alembic migrations
- Policy CRUD + activate API
- Per-algorithm parameter validation
Acceptance:
- Frontend policy switch takes effect without backend restart

### M3 - Five Redis-Based Limiters
Deliverables:
- Unified limiter interface
- 5 algorithm implementations + unit tests
Acceptance:
- Same load scenario yields distinguishable algorithm behavior

### M4 - Simulation and Logging Pipeline
Deliverables:
- Frontend request rounds simulator
- Backend log collection + logs API
- Log table rendering
Acceptance:
- Live visibility into allow/reject, reason, and latency

### M5 - Metrics and Single-Panel Comparison
Deliverables:
- Summary/timeseries metrics APIs
- ECharts one-panel comparison including P99
Acceptance:
- One panel can compare QPS, reject rate, and P99 concurrently

### M6 - Hardening and Demo Readiness
Deliverables:
- README with setup and demo walkthrough
- Seed policies
- Basic integration tests
Acceptance:
- Fresh environment can reproduce demo within 10 minutes

---

## 14. Minimum Test Requirements

### 14.1 Backend Unit Tests
At least 3 tests per algorithm:
- Under-limit requests are allowed
- Over-limit requests are rejected
- Boundary time/refill/leak behaviors are correct

### 14.2 API Integration Tests
- policy create/update/activate flow
- simulate request status code and payload
- metrics summary/timeseries response completeness

### 14.3 Frontend Sanity Checks
- Policy change updates parameter form correctly
- Simulation updates charts and logs in real time
- P99 and reject-rate visualization works

---

## 15. Implementation Constraints (for execution agent)
- English-only repository rule: all files and edits must be in English only.
- API response contracts are stable and backward-compatible within v1
- Rate-limiting decisions must rely on Redis state (not local in-memory fallback)
- Policies/parameters must persist in PostgreSQL; activation must update active policy
- No auth in v1, no extra infra (e.g., Kafka)
- All runtime configs must be env-driven
- Include minimal necessary comments and a practical README

---

## 16. Demo Script (Target Behavior)
1. Start system: `docker compose up --build`
2. Open dashboard
3. Activate `Fixed Window`, lower limit, run rounds, observe higher reject rate
4. Switch to `Token Bucket` under same load, observe reject-rate/P99 shift
5. Compare QPS, Reject Rate, and P99 in the same chart panel
6. Inspect logs for rejection reasons and `retry_after_ms`

---

## 17. Delivery Checklist
- Source code (`backend/frontend/infra`)
- Database migration files
- Dockerfiles and docker-compose
- README (with API examples)
- Basic test suite (backend-focused)
- This blueprint document

This file is the primary implementation contract in the current directory. Any deviation must be documented with rationale in implementation notes or PR description.
