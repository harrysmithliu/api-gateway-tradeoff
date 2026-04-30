# M2 Unified Execution Plan (Backend + Frontend)

## 1. Objective
Define one shared M2 plan for both backend and frontend after Fixed Window (M1), with:
- **Sliding Log** as the M2 algorithm target.
- One infrastructure stack (same PostgreSQL + same Redis instance).
- Strict algorithm-level isolation in code, data namespace, and UI tabs.

This document replaces previous M2 split docs.

---

## 2. Scope for M2

In scope:
- Add and productionize `sliding_log`.
- Keep `fixed_window` fully working.
- Frontend shows algorithm-separated tabs where each tab has independent logic.
- Backend stores runtime/config data by algorithm-separated namespaces/modules.

Out of scope:
- Implement M3+ algorithms in this milestone.
- Merge all algorithms into one shared frontend logic layer.

---

## 3. Core Architecture Rule (New Scheme)

## 3.1 Same infrastructure, separated by algorithm
- PostgreSQL: same database, algorithm-specific policy tables/modules.
- Redis: same instance, algorithm-specific key namespaces.
- Frontend: one app, separate tabs/routes per algorithm, independent page logic.

## 3.2 Isolation policy
Each algorithm has isolated:
- parameter schema
- simulation UI logic
- chart semantics/explanations
- backend runtime keyspace
- policy CRUD module/table

Only the transport shell is shared (HTTP client, layout, nav, basic utilities).

---

## 4. Backend Execution Requirements (M2)

## 4.1 Algorithm module
Implement `sliding_log` in isolated module under limiter package.  
Do not refactor fixed-window behavior unless required for compatibility.

## 4.2 Redis namespace
Use:
- `rl:fixed_window:*` for fixed window
- `rl:sliding_log:*` for sliding log

No cross-algorithm key sharing.

## 4.3 PostgreSQL separation
Use algorithm-separated policy ownership (module/table-level separation is acceptable), while keeping one active-policy selector.

Required active selector fields:
- `active_algorithm`
- `active_policy_id`
- `updated_at`

## 4.4 API model
M2 allows either:
1. Separate algorithm endpoints (preferred for isolation), or
2. Existing shared endpoints with strict algorithm branching server-side.

If shared endpoints are retained, responses must include:
- `algorithm`
- `allowed`
- `reason`
- `remaining`
- `retry_after_ms`
- `latency_ms`
- `algorithm_state`

## 4.5 Sliding Log atomicity
Use single Redis Lua path for trim + count + allow/reject + retry-after calculation.

## 4.6 Activate + reset consistency
`activate + reset_runtime_state` must be deterministic and not leave partial success ambiguity.

Accepted strategies:
- transaction + compensation
- reset-first then activate (if safe)
- explicit final status payload with deterministic fields

---

## 5. Frontend Execution Requirements (M2)

## 5.1 Tab model (hard requirement)
Use separate tabs/routes:
- `/fixed-window`
- `/sliding-log`
- reserved tabs for future:
  - `/sliding-window-counter`
  - `/token-bucket`
  - `/leaky-bucket`

## 5.2 Full logic isolation per tab
Each tab has independent:
- types
- API adapter
- hook/state machine
- chart components
- explanation text

No forced shared algorithm-spec abstraction in M2.

## 5.3 Shared layer allowed
May share:
- top navigation tab bar
- app shell styles
- generic HTTP utilities
- common table/card primitives without algorithm semantics

## 5.4 Sliding Log page requirements
Compared with fixed-window page:
- rolling-window semantics, not boundary-reset semantics
- chart explanation must describe oldest-event expiry behavior
- retry-after interpretation follows rolling log semantics

---

## 6. Contract Lock for Fixed Window + Sliding Log

For M2 rendering stability, both algorithms must provide in `algorithm_state`:
- `count`
- `window_start_ms`
- `window_size_sec`

Recommended:
- `state_schema_version: 1`

Field naming must remain stable for M2.

---

## 7. Implementation Work Breakdown

## 7.1 Backend batch
1. Add sliding-log limiter module.
2. Wire factory and policy validation for M2 algorithm set.
3. Add/confirm Redis Lua atomic path.
4. Harden activate+reset consistency.
5. Add tests (unit + integration + regression).

## 7.2 Frontend batch
1. Keep existing fixed-window page unchanged.
2. Add tab router and nav.
3. Create isolated sliding-log page (own hook/api/types/charts).
4. Connect to backend active policy / simulation flow.
5. Add tab/page-level tests.

---

## 8. Acceptance Criteria (M2)

All must pass:
1. Fixed Window tab still works with no regression.
2. Sliding Log tab works independently and reflects rolling-window behavior.
3. Backend supports create/update/activate/simulate for sliding_log.
4. Redis keys are algorithm namespaced and isolated.
5. Activate+reset flow is deterministic and documented.
6. No frontend fixed-window logic leaks into sliding-log tab logic.

---

## 9. Migration and Compatibility Notes

1. Existing fixed-window API/client code may remain in place.
2. New sliding-log tab can be introduced without refactoring fixed-window internals.
3. Future algorithms will follow the same “new isolated tab + isolated backend module” pattern.

---

## 10. Future Milestones (Preview Only)

M3/M4/M5 will repeat the same isolation strategy for:
- Sliding Window Counter
- Token Bucket
- Leaky Bucket

No additional architectural rewrite should be needed if M2 isolation is implemented cleanly.
