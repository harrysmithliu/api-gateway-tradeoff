# M4 Unified Execution Plan: Token Bucket

## 1. Objective
Deliver **Token Bucket** as the next milestone after Sliding Window Counter (M3), following the established rules:
- Single shared infrastructure (one PostgreSQL + one Redis).
- Algorithm-level isolation for backend modules, Redis namespace, and frontend tabs.
- No regressions for Fixed Window, Sliding Log, and Sliding Window Counter paths.

---

## 2. Scope

In scope:
- Backend support for `token_bucket`.
- Frontend dedicated Token Bucket tab/page with isolated logic.
- Stable simulation API response contract.
- Algorithm-specific runtime/config separation.

Out of scope:
- Leaky Bucket implementation.
- Converging all algorithm tabs into one shared semantic implementation.
- Broad UI redesign beyond Token Bucket page needs.

---

## 3. Architecture and Isolation Rules

## 3.1 Infrastructure rule
- PostgreSQL remains one shared DB instance.
- Redis remains one shared instance.
- Isolation is by algorithm module/table ownership and key namespace.

## 3.2 Backend isolation
- Separate limiter module for `token_bucket`.
- Separate Redis namespace:
  - `rl:token_bucket:{policy_id}:{client_id}:...`
- Policy validation explicitly allows `token_bucket`.

## 3.3 Frontend isolation
- New route/tab:
  - `/token-bucket`
- Dedicated page, hook, API adapter, types, charts, and explanation copy.
- No reuse of other algorithm semantic logic internals.

---

## 4. Backend Requirements

## 4.1 Token Bucket algorithm
Required parameters:
- `capacity` (int > 0)
- `refill_rate_per_sec` (float > 0)
- `tokens_per_request` (int > 0, default `1`)

Decision model:
1. Refill tokens based on elapsed time since last refill timestamp.
2. Cap tokens at `capacity`.
3. If tokens >= `tokens_per_request`, allow and deduct.
4. Otherwise reject and compute `retry_after_ms` until enough tokens are available.

## 4.2 Redis runtime model
Use algorithm-specific key(s), for example:
- `rl:token_bucket:{policy_id}:{client_id}`

Store at least:
- `tokens` (float)
- `last_refill_ms` (int64)

Atomicity:
- Use Lua or another atomic Redis strategy for refill + check + consume.

## 4.3 Policy support
Policy service must:
- allow `token_bucket` on create/update
- validate parameter schema
- support activate and optional reset behavior

## 4.4 Activate + reset consistency
Must remain deterministic and avoid partial-success ambiguity between:
- active policy in PostgreSQL
- runtime state reset in Redis

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

For Token Bucket, `algorithm_state` baseline compatibility fields (for generic consumers):
- `count` (mapped semantic value for compatibility)
- `window_start_ms` (compatibility placeholder if needed)
- `window_size_sec` (compatibility placeholder if needed)
- `state_schema_version` (recommended fixed value: `1`)

Token Bucket specific required fields:
- `tokens`
- `capacity`
- `refill_rate_per_sec`
- `tokens_per_request`
- `last_refill_ms`

Notes:
- For this algorithm, `remaining` should represent available request budget from current tokens:
  - recommended: `floor(tokens / tokens_per_request)`
- `retry_after_ms` should be `null` (or agreed stable allow value) when allowed.

---

## 6. Frontend Requirements (Dedicated Token Bucket Tab)

## 6.1 Route and tab
Enable tab/route:
- `Token Bucket`
- path: `/token-bucket`

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
- `refill rate per sec`
- `tokens per request`
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
- current tokens
- capacity
- refill rate
- estimated request budget remaining
- allow rate
- reject rate
- current RPS
- last retry-after

## 6.5 Charts
Primary chart:
- `tokens` over time with `capacity` line.

Secondary chart/panel:
- request outcomes timeline (allow/reject).
- optional refill-vs-consume trend (per-second).

## 6.6 Explanation block
Must clearly explain:
- Token Bucket allows burst traffic up to capacity.
- Long-term throughput is bounded by refill rate.
- Rejections occur when demand exceeds refill-adjusted token availability.

---

## 7. Suggested File Additions

Backend (examples):
- `gateway/internal/limiter/token_bucket.go`
- token bucket tests
- policy validation updates for token bucket params

Frontend (examples):
- `frontend/src/pages/TokenBucketDashboard.tsx`
- `frontend/src/hooks/useTokenBucketSimulation.ts`
- `frontend/src/api/tokenBucketApi.ts`
- `frontend/src/types/tokenBucket.ts`
- `frontend/src/components/token-bucket/*`

---

## 8. Testing Requirements

## 8.1 Backend unit tests
At minimum:
1. Under-budget requests are allowed and tokens decrease.
2. Over-budget requests are rejected with valid `retry_after_ms`.
3. Refill behavior matches elapsed time and refill rate.
4. Tokens never exceed capacity.
5. `algorithm_state` includes required token-specific fields.

## 8.2 Backend integration tests
1. Create/activate token bucket policy.
2. Simulate progression and verify allow/reject transitions.
3. Validate activate+reset deterministic behavior.

## 8.3 Frontend tests
1. Token Bucket tab runs independently.
2. KPI and charts map correctly from token-bucket state.
3. Tab switching does not leak state from other algorithms.

## 8.4 Regression
Must remain green:
- Fixed Window
- Sliding Log
- Sliding Window Counter

---

## 9. Acceptance Criteria

M4 is accepted only when all items pass:
1. Token Bucket backend path is production-runnable and policy-manageable.
2. Token Bucket frontend tab is fully functional and independent.
3. Charts and explanation text reflect token/refill semantics correctly.
4. API contract remains stable for prior algorithm tabs.
5. No regressions in M1/M2/M3 algorithm behavior and UI tabs.

---

## 10. Implementation Sequence
1. Backend: token bucket limiter + Redis atomic runtime path.
2. Backend: policy validation + tests.
3. Backend: integration + activate/reset consistency verification.
4. Frontend: dedicated token-bucket tab/page + API/hook/types.
5. Frontend: charts/KPIs/explanation + tests.
6. End-to-end QA and regression sweep.

---

## 11. Non-Goals
- Do not implement Leaky Bucket in M4.
- Do not merge algorithm tabs into shared semantic logic.
- Do not modify existing algorithm UX except compatibility fixes.
