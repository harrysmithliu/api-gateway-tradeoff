# Backend-First Incremental Requirements

## 1. Objective
This document resets the project scope to a backend-first incremental delivery model.

Primary goals:
- Implement backend capabilities first; frontend design/implementation is deferred.
- Deliver rate limiter algorithms one by one in strict order.
- Require each phase to be runnable, testable, and regression-safe before moving to the next algorithm.

---

## 2. Mandatory Algorithm Order

Algorithms must be implemented and accepted in this exact sequence:

1. Fixed Window
2. Sliding Log
3. Sliding Window Counter
4. Token Bucket
5. Leaky Bucket

No phase may include implementation work for later-phase algorithms.

---

## 3. Phase Definition of Done (DoD)

Each phase is complete only when all checks pass:

1. Algorithm is implemented behind a unified limiter interface.
2. Runtime state is stored and evaluated via Redis (no in-memory fallback path).
3. Parameter schema validation is enforced for the algorithm.
4. Unit tests cover normal, limit-exceeded, and boundary-time/refill/leak behavior.
5. Minimal integration tests validate API-level allow/reject behavior.
6. Existing tests from prior phases remain green (regression-safe).
7. Phase notes include accepted parameters and known limitations.

---

## 4. Current Scope (Backend Only)

In scope:
- FastAPI + Uvicorn backend
- Redis runtime state for limiters
- PostgreSQL for policy storage and activation state
- Docker Compose local deployment
- API contracts for policy management and request simulation

Out of scope (for now):
- Frontend UI and visualization decisions
- AuthN/AuthZ
- Advanced distributed consistency and multi-node synchronization

---

## 5. Fixed Technology Stack

- Backend: FastAPI, Uvicorn, Pydantic, SQLAlchemy, Alembic
- Runtime state: Redis
- Policy/config persistence: PostgreSQL
- Local deployment: Docker Compose

No additional infrastructure should be introduced unless explicitly approved.

---

## 6. Minimum Stable API Contract

These endpoints are the stable baseline for incremental backend delivery:

1. `POST /api/policies`
   - Create policy
2. `PUT /api/policies/{id}`
   - Update policy fields and parameters
3. `POST /api/policies/{id}/activate`
   - Activate selected policy
4. `GET /api/policies/active`
   - Get currently active policy
5. `POST /api/simulate/request`
   - Simulate one request and return limiter decision
6. `GET /api/health`
   - Health check

Notes:
- Metrics/log endpoints may be deferred until after early algorithm phases.
- Backward compatibility must be preserved once endpoints are in use.

---

## 7. Data Ownership Rules

PostgreSQL responsibilities:
- Policy definitions
- Policy versioning metadata
- Active policy state

Redis responsibilities:
- Algorithm runtime state and counters/tokens/windows
- Optional short-lived metrics buffers

Hard rule:
- Limiter decision path must read/write Redis runtime state.

---

## 8. Milestones

## M0 - Foundation
Deliverables:
- Backend project skeleton
- Docker Compose stack
- DB migrations for policy tables
- Unified limiter interface and base abstractions
- Baseline policy/simulation APIs

Acceptance:
- Services boot successfully
- Policy create/update/activate flow works

## M1 - Fixed Window
Deliverables:
- Fixed Window limiter implementation
- Parameter validation
- Unit + integration tests

Acceptance:
- Requests beyond limit within a window return `429`
- Window reset behavior validated

## M2 - Sliding Log
Deliverables:
- Redis ZSET-based sliding log implementation
- Validation and tests

Acceptance:
- Sliding window count is correct at boundary timestamps
- Behavioral difference vs M1 is demonstrable

## M3 - Sliding Window Counter
Deliverables:
- Current+previous window weighted implementation
- Validation and tests

Acceptance:
- Edge transitions are smooth and expected

## M4 - Token Bucket
Deliverables:
- Token refill/consume logic
- Validation and tests

Acceptance:
- Bursts are allowed within capacity
- Sustained rate is constrained by refill rate

## M5 - Leaky Bucket
Deliverables:
- Water-level and leak-rate logic
- Validation and tests

Acceptance:
- Output rate is smoothed
- Overload rejection matches parameters

## M6 - Consolidation
Deliverables:
- Unified error semantics and docs
- Regression suite and smoke scripts
- Frontend handoff API notes

Acceptance:
- All five algorithms pass tests and can be switched via active policy

---

## 9. Testing Requirements

Per algorithm (mandatory):
- Under-limit allows
- Over-limit rejects
- Boundary behavior correctness

API integration (mandatory):
- Policy lifecycle endpoints work end-to-end
- Active policy influences simulation decision path
- Proper status codes and response fields are returned

Regression:
- Adding a new algorithm must not break prior algorithms.

---

## 10. Governance and Constraints

1. Deliver only the current milestone scope.
2. Do not pre-implement future milestones.
3. Keep API contracts stable across phases.
4. All files, docs, comments, and artifacts must remain English-only.
5. Any deviation must be documented with explicit rationale.

---

## 11. Supersession

This document supersedes prior full-stack planning for execution sequencing.

If conflicts exist:
- This backend-first incremental requirements document takes precedence for implementation order and scope.
