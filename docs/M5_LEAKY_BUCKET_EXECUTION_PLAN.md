# M5 Unified Execution Plan: Leaky Bucket

## 1. Objective
Deliver **Leaky Bucket** as the final algorithm milestone in the current sequence, while preserving:
- Shared infrastructure (single PostgreSQL + single Redis).
- Algorithm-level isolation in backend modules, Redis namespaces, and frontend tabs.
- Full backward compatibility for Fixed Window, Sliding Log, Sliding Window Counter, and Token Bucket.

---

## 2. Scope

In scope:
- Backend support for `leaky_bucket`.
- Frontend dedicated Leaky Bucket tab/page with isolated logic.
- Stable simulation API response contract.
- Algorithm-specific runtime/config separation.

Out of scope:
- Cross-algorithm semantic unification refactor.
- New platform components unrelated to Leaky Bucket.

---

## 3. Architecture and Isolation Rules

## 3.1 Infrastructure rule
- PostgreSQL remains one shared DB instance.
- Redis remains one shared instance.
- Isolation is enforced by module boundaries and key namespaces.

## 3.2 Backend isolation
- Separate limiter module for `leaky_bucket`.
- Separate Redis namespace:
  - `rl:leaky_bucket:{policy_id}:{client_id}:...`
- Policy validation explicitly supports `leaky_bucket`.

## 3.3 Frontend isolation
- New route/tab:
  - `/leaky-bucket`
- Dedicated page, hook, API adapter, types, chart logic, and explanation text.
- No reuse of algorithm-specific internals from other tabs.

---

## 4. Backend Requirements

## 4.1 Leaky Bucket algorithm
Required parameters:
- `capacity` (int > 0)
- `leak_rate_per_sec` (float > 0)
- `water_per_request` (int > 0, default `1`)

Decision model:
1. Leak bucket water based on elapsed time since last leak timestamp.
2. Clamp water level at minimum `0`.
3. If `water_level + water_per_request <= capacity`, allow and add water.
4. Otherwise reject and compute `retry_after_ms` until enough water leaks out.

## 4.2 Redis runtime model
Use an algorithm-specific key, for example:
- `rl:leaky_bucket:{policy_id}:{client_id}`

Store at least:
- `water_level` (float)
- `last_leak_ms` (int64)

Atomicity:
- Use Lua or equivalent atomic strategy for leak + check + update.

## 4.3 Policy support
Policy service must:
- allow `leaky_bucket` in create/update validation
- validate parameter schema
- support activate and optional reset behavior

## 4.4 Activate + reset consistency
Must remain deterministic and avoid partial success ambiguity between:
- active policy in PostgreSQL
- runtime reset in Redis

---

## 5. Simulation API Contract

Keep common response fields stable:
- `algorithm`
- `allowed`
- `reason`
- `remaining`
- `retry_after_ms`
- `latency_ms`
- `algorithm_state`

For Leaky Bucket, include baseline compatibility fields:
- `count` (compatibility semantic value)
- `window_start_ms` (compatibility placeholder if needed)
- `window_size_sec` (compatibility placeholder if needed)
- `state_schema_version` (recommended fixed value: `1`)

Leaky Bucket specific required fields:
- `water_level`
- `capacity`
- `leak_rate_per_sec`
- `water_per_request`
- `last_leak_ms`

Notes:
- `remaining` should represent current headroom in request units when possible.
- `retry_after_ms` should follow documented stable semantics for allow/reject.

---

## 6. Frontend Requirements (Dedicated Leaky Bucket Tab)

## 6.1 Route and tab
Enable tab/route:
- `Leaky Bucket`
- path: `/leaky-bucket`

## 6.2 Dedicated page implementation
Create isolated page with:
- own config state
- own simulation loop
- own API mapping
- own KPI derivation
- own chart semantics

## 6.3 Simulation controls
Required controls:
- `capacity`
- `leak rate per sec`
- `water per request`
- `rps`
- `duration (sec)`
- `concurrency`
- `client id mode`
- `single client id`
- `rotating pool size`

Actions:
- `start`
- `pause/resume`
- `stop`
- `reset view`

## 6.4 KPI cards
Required:
- current water level
- capacity
- leak rate
- remaining headroom
- allow rate
- reject rate
- current RPS
- last retry-after

## 6.5 Charts
Primary chart:
- `water_level` over time with `capacity` line.

Secondary chart/panel:
- allow/reject timeline.
- optional leak-vs-inflow trend (per-second view).

## 6.6 Explanation block
Must clearly explain:
- Leaky Bucket smooths output by draining at fixed leak rate.
- Bursty arrivals may be rejected when bucket fills faster than leak rate.
- Behavior differs from Token Bucket (stored tokens vs stored water/backlog).

---

## 7. Suggested File Additions

Backend (examples):
- `gateway/internal/limiter/leaky_bucket.go`
- leaky bucket tests
- policy validation updates for leaky bucket params

Frontend (examples):
- `frontend/src/pages/LeakyBucketDashboard.tsx`
- `frontend/src/hooks/useLeakyBucketSimulation.ts`
- `frontend/src/api/leakyBucketApi.ts`
- `frontend/src/types/leakyBucket.ts`
- `frontend/src/components/leaky-bucket/*`

---

## 8. Testing Requirements

## 8.1 Backend unit tests
At minimum:
1. Under-capacity requests are allowed and water increases.
2. Over-capacity requests are rejected with valid `retry_after_ms`.
3. Leak behavior matches elapsed time and leak rate.
4. Water level never exceeds capacity and never drops below zero.
5. `algorithm_state` includes required leaky-bucket-specific fields.

## 8.2 Backend integration tests
1. Create/activate leaky bucket policy.
2. Simulate progression and verify allow/reject transitions.
3. Validate activate+reset deterministic behavior.

## 8.3 Frontend tests
1. Leaky Bucket tab runs independently.
2. KPI and charts map correctly from leaky-bucket state.
3. Tab switching does not leak state across algorithms.

## 8.4 Regression
Must remain green:
- Fixed Window
- Sliding Log
- Sliding Window Counter
- Token Bucket

---

## 9. Acceptance Criteria

M5 is accepted only when all items pass:
1. Leaky Bucket backend path is production-runnable and policy-manageable.
2. Leaky Bucket frontend tab is fully functional and independent.
3. Charts and explanation text reflect leak-rate and water-level semantics correctly.
4. API contract remains stable for all prior algorithm tabs.
5. No regressions in M1–M4 algorithm behavior and UI tabs.

---

## 10. Implementation Sequence
1. Backend: leaky bucket limiter + Redis atomic runtime path.
2. Backend: policy validation + tests.
3. Backend: integration + activate/reset consistency verification.
4. Frontend: dedicated leaky-bucket tab/page + API/hook/types.
5. Frontend: charts/KPIs/explanation + tests.
6. End-to-end QA and full regression sweep.

---

## 11. Non-Goals
- Do not redesign existing tabs in this milestone.
- Do not merge algorithm tabs into one semantic engine.
- Do not alter prior algorithm UX except required compatibility fixes.
