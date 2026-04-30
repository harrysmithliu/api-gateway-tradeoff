# M1 Phase Notes - Fixed Window

## Accepted Parameters
- `algorithm`: `fixed_window`
- `params_json.window_size_sec`: integer, `> 0`
- `params_json.limit`: integer, `> 0`

## Stable APIs in M1
- `POST /api/policies`
- `PUT /api/policies/{id}`
- `POST /api/policies/{id}/activate`
- `GET /api/policies/active`
- `POST /api/simulate/request`
- `GET /api/health`

## Behavior
- Runtime counters are maintained in Redis using key pattern:
  - `rl:fixed_window:{policy_id}:{client_id}:{window_start_ms}`
- Allow path returns HTTP `200`.
- Reject path returns HTTP `429` with `reason=rate_limit_exceeded` and `retry_after_ms`.

## Known Limitations (Intentional in M1)
- Only `fixed_window` is executable in this milestone.
- Other algorithms (`sliding_log`, `sliding_window_counter`, `token_bucket`, `leaky_bucket`) are preserved as switch slots but not implemented.
- Proxy authn/authz and advanced gateway concerns are out of this milestone scope.
