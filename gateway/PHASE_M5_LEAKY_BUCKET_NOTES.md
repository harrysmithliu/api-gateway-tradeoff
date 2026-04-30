# Phase M5 Notes: Leaky Bucket (Backend)

## Scope
This note defines backend contract semantics for M5 `leaky_bucket`.

## Supported algorithms in current phase
- `fixed_window`
- `sliding_log`
- `sliding_window_counter`
- `token_bucket`
- `leaky_bucket`

## Leaky Bucket policy params
Required:
- `capacity` (`int > 0`)
- `leak_rate_per_sec` (`float > 0`)

Optional:
- `water_per_request` (`int > 0`, default `1`)

## Runtime namespace
- `rl:leaky_bucket:{policy_id}:{client_id}`

Runtime state includes:
- `water_level` (float)
- `last_leak_ms` (int64)

## Simulation response contract
Common response fields remain stable:
- `algorithm`
- `allowed`
- `reason`
- `remaining`
- `retry_after_ms`
- `latency_ms`
- `algorithm_state`

## Leaky Bucket algorithm_state fields
Baseline compatibility:
- `count`
- `window_start_ms`
- `window_size_sec`
- `state_schema_version` (`1`)

Leaky-bucket-specific:
- `water_level`
- `capacity`
- `leak_rate_per_sec`
- `water_per_request`
- `last_leak_ms`

## remaining semantics
- `remaining` represents current request headroom:
  - `floor((capacity - water_level) / water_per_request)`
  - clamped at `>= 0`

## retry_after_ms semantics
- allow decision:
  - `retry_after_ms` omitted
- reject decision:
  - `retry_after_ms` present and positive (ms until enough water leaks out)
