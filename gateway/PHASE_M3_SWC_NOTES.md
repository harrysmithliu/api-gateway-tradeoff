# Phase M3 Notes: Sliding Window Counter (Backend)

## Scope
This note documents backend contract semantics for M3 `sliding_window_counter`, aligned with frontend integration expectations.

## Supported algorithms in current phase
- `fixed_window`
- `sliding_log`
- `sliding_window_counter`

## SWC policy params
Required fields in `params_json`:
- `window_size_sec` (`int > 0`)
- `limit` (`int > 0`)

## Runtime namespace
- SWC counter keys:
  - `rl:sliding_window_counter:{policy_id}:{client_id}:{window_start_ms}`

## Simulation response contract
Common response fields remain stable:
- `algorithm`
- `allowed`
- `reason`
- `remaining`
- `retry_after_ms`
- `latency_ms`
- `algorithm_state`

## SWC algorithm_state fields
Baseline fields:
- `count` (maps to `estimated_count`)
- `window_start_ms`
- `window_size_sec`
- `state_schema_version` (`1`)

SWC-specific fields:
- `current_window_count`
- `previous_window_count`
- `previous_window_weight`
- `estimated_count`

## retry_after_ms semantics
- allow decision:
  - `retry_after_ms` is omitted (`null` at JSON contract level)
- reject decision:
  - `retry_after_ms` is present and is a positive integer in milliseconds

This behavior is intentionally consistent across M1/M2/M3 algorithms.
