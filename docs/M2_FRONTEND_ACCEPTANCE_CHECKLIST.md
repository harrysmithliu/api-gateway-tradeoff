# M2 Frontend Acceptance Checklist (Tab Isolation + Sliding Log)

Date: 2026-04-30

## 1. Routing and Tab Isolation

- [ ] `/fixed-window` opens Fixed Window page.
- [ ] `/sliding-log` opens Sliding Log page.
- [ ] Reserved tabs are visible and marked as reserved:
  - `Sliding Window Counter`
  - `Token Bucket`
  - `Leaky Bucket`
- [ ] Clicking reserved tabs does not navigate away from current active tab.

## 2. Fixed Window Regression

- [ ] Fixed Window controls still start/pause/resume/stop simulation.
- [ ] Fixed Window KPI cards still update from live events.
- [ ] Fixed Window occupancy + outcome charts still render.
- [ ] Fixed Window request table and diagnostics still work.

## 3. Sliding Log Core Behavior

- [ ] Sliding Log controls can sync policy and start simulation.
- [ ] Active policy shown in header is `sliding_log`.
- [ ] Occupancy chart reflects rolling behavior (count may drop as old events expire).
- [ ] Outcome timeline shows allow/reject points with retry-after and count details.
- [ ] Request log table supports `Rejected only` and `Auto-scroll`.

## 4. Contract Checks (Sliding Log)

- [ ] `Contract Checks` panel is visible.
- [ ] `Baseline state gaps` remains `0` during normal backend responses.
- [ ] `Missing state_schema_version` stays `0` when backend includes schema version.
- [ ] `Allow decisions with retry_after_ms` remains `0` in normal flow.
- [ ] Any contract drift appears in `Diagnostics` as warnings without page crash.

## 5. Build and Test Gate

- [ ] `npm run build` passes.
- [ ] `npm test` passes.
- [ ] Docker frontend container is healthy after rebuild.
