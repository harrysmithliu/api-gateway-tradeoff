# M3 Unified Execution Plan: Sliding Window Counter

## 1. Objective
Deliver **Sliding Window Counter (SWC)** as the next algorithm milestone after Fixed Window (M1) and Sliding Log (M2), under the current architecture rules:
- Same infrastructure (single PostgreSQL + single Redis deployment).
- Algorithm-level isolation in backend modules and frontend tabs.
- No regression for existing Fixed Window and Sliding Log paths.

---

## 2. Scope

In scope:
- Backend support for `sliding_window_counter`.
- Frontend dedicated SWC tab/page with isolated logic.
- Stable API contract for simulation responses.
- Redis and policy separation by algorithm namespace/module.

Out of scope:
- Token Bucket and Leaky Bucket implementation.
- Refactoring existing algorithm pages into a shared semantic engine.
- Major UI redesign outside SWC tab.

---

## 3. Architecture and Isolation Rules

## 3.1 Infrastructure rule
- PostgreSQL remains one shared DB instance.
- Redis remains one shared instance.
- Isolation is achieved by algorithm-specific modules/tables/namespaces.

## 3.2 Backend isolation
- Separate limiter module for `sliding_window_counter`.
- Separate Redis key namespace:
  - `rl:sliding_window_counter:{policy_id}:{client_id}:...`
- Policy validation and creation paths must explicitly allow this algorithm.

## 3.3 Frontend isolation
- New route/tab:
  - `/sliding-window-counter`
- Dedicated page, hook, API adapter, types, charts, and explanation copy.
- Do not reuse fixed-window/sliding-log semantic logic internals.

---

## 4. Backend Requirements

## 4.1 Algorithm
Implement SWC decision based on:
- current window count
- previous window count
- previous window overlap weight

Recommended estimate:
- `estimated_count = current_count + previous_count * previous_weight`

Allow when:
- `estimated_count < limit`

Reject when:
- `estimated_count >= limit`

## 4.2 Parameters
Required:
- `window_size_sec` (int > 0)
- `limit` (int > 0)

## 4.3 Redis key strategy
Use algorithm namespace with window-specific keys (or equivalent structure), for example:
- current window key
- previous window key

TTL:
- long enough to include current + previous window reads safely.

## 4.4 Policy support
Policy service must:
- accept `sliding_window_counter` in create/update validation
- validate required params
- support activation and optional runtime reset

## 4.5 Activate + reset consistency
Must remain deterministic:
- no partial success ambiguity between DB active policy and Redis runtime state.

Accepted approach:
- compensation or reset-first strategy, or explicit deterministic status metadata.

---

## 5. Simulation API Contract

Keep existing response shape stable:
- `algorithm`
- `allowed`
- `reason`
- `remaining`
- `retry_after_ms`
- `latency_ms`
- `algorithm_state`

For SWC, `algorithm_state` must include baseline fields:
- `count`
- `window_start_ms`
- `window_size_sec`
- `state_schema_version` (recommended fixed value: `1`)

SWC-specific fields (required for explainability):
- `current_window_count`
- `previous_window_count`
- `previous_window_weight`
- `estimated_count`

Notes:
- `count` should map to `estimated_count` for baseline compatibility.
- `retry_after_ms` semantics for allow/reject must be documented and consistent.

---

## 6. Frontend Requirements (Dedicated SWC Tab)

## 6.1 Route and tab
Enable tab/route:
- `Sliding Window Counter`
- path: `/sliding-window-counter`

Tab status:
- enabled when backend policy and simulation are available.

## 6.2 Dedicated page implementation
Create isolated page with:
- own config state
- own request simulation loop
- own API mapping
- own KPI derivation
- own chart logic

## 6.3 Simulation controls
Required controls:
- `limit`
- `window size (sec)`
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
- window range
- estimated count / limit
- remaining
- allow rate
- reject rate
- current RPS
- last retry-after

SWC-specific KPI:
- previous-window contribution ratio (or equivalent indicator)

## 6.5 Charts
Primary chart:
- `estimated_count` vs `limit` over time

Secondary chart/panel:
- contribution split:
  - current-window contribution
  - previous-window weighted contribution

Outcome timeline:
- allow/reject scatter remains required.

## 6.6 Explanation block
Must explicitly explain:
- SWC smooths boundary transitions by mixing current + weighted previous window.
- Different from fixed-window hard reset behavior.

---

## 7. Suggested File Additions

Backend (examples):
- `gateway/internal/limiter/sliding_window_counter.go`
- tests for SWC limiter
- policy validation updates

Frontend (examples):
- `frontend/src/pages/SlidingWindowCounterDashboard.tsx`
- `frontend/src/hooks/useSlidingWindowCounterSimulation.ts`
- `frontend/src/api/slidingWindowCounterApi.ts`
- `frontend/src/types/slidingWindowCounter.ts`
- `frontend/src/components/sliding-window-counter/*`

---

## 8. Testing Requirements

## 8.1 Backend unit tests
At minimum:
1. Under-limit requests are allowed.
2. Over-limit requests are rejected.
3. Boundary transition behavior is smoother than fixed-window reset profile.
4. `algorithm_state` includes baseline + SWC-specific fields.

## 8.2 Backend integration tests
1. Create/activate SWC policy.
2. Simulate request progression and verify allow/reject outcomes.
3. Validate activate+reset deterministic behavior.

## 8.3 Frontend tests
1. SWC tab loads and runs independently.
2. KPI and chart values map correctly from SWC `algorithm_state`.
3. Switching tabs does not leak state between algorithms.

## 8.4 Regression
Must remain green:
- Fixed Window tab and tests.
- Sliding Log tab and tests.

---

## 9. Acceptance Criteria

M3 is accepted only when all items pass:
1. SWC backend path is production-runnable and policy-manageable.
2. SWC frontend tab is fully functional and independent.
3. Charts and explanations correctly represent SWC semantics.
4. API contract remains stable for existing algorithms.
5. No regressions in M1/M2 algorithms and tabs.

---

## 10. Implementation Sequence
1. Backend: SWC limiter + policy validation + tests.
2. Backend: integration + reset consistency verification.
3. Frontend: dedicated SWC tab/page + API/hook/types.
4. Frontend: KPI/chart/explanation + tests.
5. End-to-end QA and regression sweep.

---

## 11. Non-Goals
- Do not implement Token Bucket or Leaky Bucket in M3.
- Do not collapse tabs into one semantic engine in this milestone.
- Do not alter existing fixed/sliding-log UX flows except compatibility fixes.
