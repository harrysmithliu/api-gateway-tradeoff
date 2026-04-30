# Phase M4 Notes: Token Bucket (Backend)

## Scope
This note defines backend contract semantics for M4 `token_bucket`.

## Supported algorithms in current phase
- `fixed_window`
- `sliding_log`
- `sliding_window_counter`
- `token_bucket`

## Token Bucket policy params
Required:
- `capacity` (`int > 0`)
- `refill_rate_per_sec` (`float > 0`)

Optional:
- `tokens_per_request` (`int > 0`, default `1`)

## Runtime namespace
- `rl:token_bucket:{policy_id}:{client_id}`

Runtime state includes:
- `tokens` (float)
- `last_refill_ms` (int64)

## Simulation response contract
Common response fields remain stable:
- `algorithm`
- `allowed`
- `reason`
- `remaining`
- `retry_after_ms`
- `latency_ms`
- `algorithm_state`

## Token Bucket algorithm_state fields
Baseline compatibility:
- `count`
- `window_start_ms`
- `window_size_sec`
- `state_schema_version` (`1`)

Token-bucket-specific:
- `tokens`
- `capacity`
- `refill_rate_per_sec`
- `tokens_per_request`
- `last_refill_ms`

## remaining semantics
- `remaining` represents request budget derived from current token balance:
  - `floor(tokens / tokens_per_request)`

## retry_after_ms semantics
- allow decision:
  - `retry_after_ms` omitted
- reject decision:
  - `retry_after_ms` present and positive (ms to accumulate enough tokens)
