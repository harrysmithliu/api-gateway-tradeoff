# Frontend Spec: Fixed Window Rate Limiter Visualization

## 1. Purpose
Build a dedicated frontend page to visualize how the **Fixed Window** limiter behaves in real time.

This is a focused implementation for one algorithm only (Fixed Window), aligned with the backend-first incremental roadmap.

---

## 2. Scope

In scope:
- Request simulation controls (start/pause/stop)
- Realtime limiter state cards
- Visualization for window boundaries, request outcomes, and saturation
- Request log table
- Polling-based data updates

Out of scope:
- Multi-algorithm comparison UI
- Authentication
- WebSocket streaming
- Historical analytics beyond short in-memory session

---

## 3. Target User Outcomes
The user should be able to clearly observe:
1. Current window start/end time.
2. Current request count relative to limit.
3. Per-request allow/reject decisions.
4. Retry wait behavior after rejection (`retry_after_ms`).
5. The reset effect when a new window begins.

---

## 4. Backend Contract Required by Frontend

## 4.1 Required endpoint
- `POST /api/simulate/request`

Request body:
```json
{
  "client_id": "client-a",
  "run_id": "optional-uuid"
}
```

Expected response shape (minimum required fields):
```json
{
  "request_id": "uuid",
  "ts": "2026-04-29T15:00:00Z",
  "policy_id": "uuid",
  "algorithm": "fixed_window",
  "allowed": true,
  "reason": null,
  "retry_after_ms": null,
  "latency_ms": 3,
  "remaining": 97,
  "client_id": "client-a",
  "algorithm_state": {
    "count": 3,
    "window_start_ms": 1714400000000,
    "window_size_sec": 10
  }
}
```

## 4.2 Required guarantees
1. `algorithm` must be `"fixed_window"` during this phase.
2. `algorithm_state.count` is current count after decision.
3. `algorithm_state.window_start_ms` is deterministic for all requests in the same window.
4. `retry_after_ms` is non-null when `allowed=false`.

---

## 5. UI Information Architecture

Single page: `FixedWindowDashboard`

Sections:
1. Simulation Controls
2. Realtime KPI Cards
3. Window Occupancy Chart (primary)
4. Request Outcome Timeline
5. Request Log Table

---

## 6. Detailed UI Requirements

## 6.1 Simulation Controls
Controls:
- `Limit` (int, >0)
- `Window Size (sec)` (int, >0)
- `RPS` (int, >0)
- `Duration (sec)` (int, >0)
- `Concurrency` (int, >0)
- `Client ID mode` (`single` | `rotating`)

Buttons:
- `Start`
- `Pause` / `Resume`
- `Stop`
- `Reset View`

Behavior:
1. `Start` creates a local simulation session and begins request loop.
2. `Pause` halts new request dispatch; in-flight requests may finish.
3. `Stop` ends simulation and marks session complete.
4. `Reset View` clears chart/log buffers only (does not modify backend policy).

---

## 6.2 Realtime KPI Cards
Show:
- Current Window Range (`window_start` to `window_end`)
- `Count / Limit`
- `Remaining`
- `Allow Rate` (%)
- `Reject Rate` (%)
- `Current RPS` (observed)
- `Last Retry After (ms)` (if any rejection occurred)

Update interval:
- 250ms to 1000ms acceptable; target 500ms visual freshness.

---

## 6.3 Window Occupancy Chart (Primary Chart)
Purpose:
- Make Fixed Window behavior obvious (fill window -> reject burst -> reset).

Chart definition:
- X-axis: wall-clock time
- Y-axis: count
- Series A: `count` over time
- Series B: horizontal `limit` line
- Markers: vertical lines for each window boundary

Visual rules:
1. Count line in teal/blue.
2. Limit line in contrasting static color.
3. Rejection moments highlighted as red dots on count line.
4. Boundary lines dashed.

---

## 6.4 Request Outcome Timeline
Purpose:
- Show each request result chronologically.

Chart definition:
- X-axis: time
- Y-axis: discrete lane index (or constant value)
- Green dot: allowed request
- Red dot: rejected request
- Tooltip fields:
  - `ts`
  - `allowed`
  - `count`
  - `remaining`
  - `retry_after_ms`
  - `latency_ms`

---

## 6.5 Request Log Table
Columns:
- Time
- Request ID
- Client ID
- Result (`ALLOW`/`REJECT`)
- Count
- Remaining
- Retry After (ms)
- Latency (ms)
- Reason

Table features:
- `Rejected only` filter
- `Auto-scroll` toggle
- Max retained rows in UI memory: 2000 (drop oldest first)

---

## 7. Frontend State Model

## 7.1 Core state
- `status`: `idle | running | paused | stopping`
- `config`: controls payload
- `events[]`: per-request response records
- `kpiSnapshot`: computed from recent events
- `windowBoundaries[]`: derived from `window_start_ms/window_size_sec`

## 7.2 Derived computations
- `currentCount` from latest event `algorithm_state.count`
- `currentWindowEnd = window_start_ms + window_size_sec * 1000`
- `rejectRate = rejected / total`
- `allowRate = allowed / total`
- `observedRps` from last 1-second bucket

---

## 8. Runtime Flow
1. User configures inputs and clicks `Start`.
2. Frontend dispatches requests at configured rate/concurrency.
3. For each response:
   - append event
   - update KPI snapshot
   - update charts
4. If paused:
   - stop dispatching new requests
5. If stopped or duration reached:
   - finalize local session state as `idle`

---

## 9. Edge Cases
1. Backend timeout/error:
   - add synthetic error event
   - keep simulation running unless error-rate threshold is hit
2. Non-fixed-window response:
   - show warning banner: "Unexpected algorithm response"
3. Missing `algorithm_state` fields:
   - chart continues with gaps
   - surface warning in diagnostics area

---

## 10. Suggested Component Breakdown

Suggested file plan:
- `frontend/src/pages/FixedWindowDashboard.tsx`
- `frontend/src/components/fixed-window/SimulationControls.tsx`
- `frontend/src/components/fixed-window/KpiCards.tsx`
- `frontend/src/components/fixed-window/WindowOccupancyChart.tsx`
- `frontend/src/components/fixed-window/OutcomeTimeline.tsx`
- `frontend/src/components/fixed-window/RequestLogTable.tsx`
- `frontend/src/hooks/useFixedWindowSimulation.ts`
- `frontend/src/types/fixedWindow.ts`

---

## 11. ECharts Requirements
Use ECharts for both charts.

Chart 1 (`WindowOccupancyChart`):
- line series for count
- markLine for limit and boundaries
- scatter overlay for reject points

Chart 2 (`OutcomeTimeline`):
- scatter series with color mapped by `allowed`
- tooltip formatter with required fields

Performance:
- cap points rendered to last 2000 events
- avoid full option recreation on each event; update incremental data where possible

---

## 12. Acceptance Criteria
All criteria must pass:

1. Under `limit=10`, `window=10s`, `rps=20`, chart shows:
   - rapid fill to 10
   - sustained rejects in same window
   - reset near boundary and temporary recovery
2. Rejected request rows show non-null `retry_after_ms`.
3. KPI `Count/Limit` matches latest response `algorithm_state.count`.
4. Pause prevents new request dispatch; resume continues same session.
5. Stop ends dispatch and leaves charts/logs intact for review.
6. UI remains responsive with 2000 retained events.

---

## 13. Non-Functional Requirements
1. English-only UI text and source comments.
2. No hard dependency on WebSocket.
3. Must work on desktop width >= 1280 and mobile width >= 375.
4. Avoid blocking main thread with heavy recalculation loops.

---

## 14. Handoff Notes for Frontend Agent
1. Build this page as an isolated mode first; do not refactor multi-algorithm architecture yet.
2. Keep API adapter thin and typed.
3. Prefer deterministic rendering over visual complexity.
4. If backend fields differ, document mismatch and add mapping layer without breaking UI internals.

---

## 15. Future Extension Hooks (Not for this phase)
1. Algorithm switcher tabs when M2+ algorithms are ready.
2. Overlay compare mode across algorithms.
3. Persisted run replay from backend metrics/log APIs.
