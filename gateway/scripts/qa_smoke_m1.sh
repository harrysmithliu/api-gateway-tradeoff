#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
API_BASE="${BASE_URL%/}/api"

fail() {
  echo "[FAIL] $1" >&2
  exit 1
}

note() {
  echo "[INFO] $1"
}

assert_http_status() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [ "$actual" != "$expected" ]; then
    fail "$label expected HTTP $expected but got $actual"
  fi
}

extract_json_field() {
  local json="$1"
  local field="$2"
  python3 - "$json" "$field" <<'PY'
import json,sys
payload=json.loads(sys.argv[1])
field=sys.argv[2]
value=payload
for part in field.split('.'):
    value=value[part]
print(value)
PY
}

request() {
  local method="$1"
  local url="$2"
  local body="${3:-}"

  local response
  if [ -n "$body" ]; then
    response=$(curl -sS -X "$method" "$url" -H 'Content-Type: application/json' -d "$body" -w '\nHTTP_STATUS:%{http_code}')
  else
    response=$(curl -sS -X "$method" "$url" -w '\nHTTP_STATUS:%{http_code}')
  fi

  local http_status
  http_status=$(printf '%s' "$response" | sed -n 's/^HTTP_STATUS://p')
  local payload
  payload=$(printf '%s' "$response" | sed '/^HTTP_STATUS:/d')

  printf '%s\n%s' "$http_status" "$payload"
}

note "Checking gateway health at ${API_BASE}/health"
health_result=$(request GET "${API_BASE}/health")
health_status=$(printf '%s' "$health_result" | sed -n '1p')
health_body=$(printf '%s' "$health_result" | sed -n '2,$p')
assert_http_status "$health_status" "200" "health"
health_state=$(extract_json_field "$health_body" "status")
note "Health status: ${health_state}"

name="qa-m1-fixed-$(date +%s)"
note "Creating fixed-window policy: ${name}"
create_body="{\"name\":\"${name}\",\"algorithm\":\"fixed_window\",\"params_json\":{\"window_size_sec\":60,\"limit\":1},\"enabled\":true,\"description\":\"qa smoke m1\"}"
create_result=$(request POST "${API_BASE}/policies" "$create_body")
create_status=$(printf '%s' "$create_result" | sed -n '1p')
create_payload=$(printf '%s' "$create_result" | sed -n '2,$p')
assert_http_status "$create_status" "201" "create policy"
policy_id=$(extract_json_field "$create_payload" "id")
algorithm=$(extract_json_field "$create_payload" "algorithm")
[ "$algorithm" = "fixed_window" ] || fail "created policy algorithm mismatch"
note "Created policy id: ${policy_id}"

note "Activating policy"
activate_result=$(request POST "${API_BASE}/policies/${policy_id}/activate?reset_runtime_state=false")
activate_status=$(printf '%s' "$activate_result" | sed -n '1p')
assert_http_status "$activate_status" "200" "activate policy"

note "Simulate request #1 (expect 200)"
req_body='{"client_id":"qa-client"}'
first_result=$(request POST "${API_BASE}/simulate/request" "$req_body")
first_status=$(printf '%s' "$first_result" | sed -n '1p')
first_payload=$(printf '%s' "$first_result" | sed -n '2,$p')
assert_http_status "$first_status" "200" "simulate request 1"
first_allowed=$(extract_json_field "$first_payload" "allowed")
[ "$first_allowed" = "True" ] || [ "$first_allowed" = "true" ] || fail "first request should be allowed"

note "Simulate request #2 (expect 429)"
second_result=$(request POST "${API_BASE}/simulate/request" "$req_body")
second_status=$(printf '%s' "$second_result" | sed -n '1p')
second_payload=$(printf '%s' "$second_result" | sed -n '2,$p')
assert_http_status "$second_status" "429" "simulate request 2"
second_reason=$(extract_json_field "$second_payload" "reason")
[ "$second_reason" = "rate_limit_exceeded" ] || fail "second request reason mismatch"

note "Activate with reset_runtime_state=true"
reset_result=$(request POST "${API_BASE}/policies/${policy_id}/activate?reset_runtime_state=true")
reset_status=$(printf '%s' "$reset_result" | sed -n '1p')
assert_http_status "$reset_status" "200" "activate with reset"

note "Simulate request #3 after reset (expect 200)"
third_result=$(request POST "${API_BASE}/simulate/request" "$req_body")
third_status=$(printf '%s' "$third_result" | sed -n '1p')
third_payload=$(printf '%s' "$third_result" | sed -n '2,$p')
assert_http_status "$third_status" "200" "simulate request 3 after reset"
third_allowed=$(extract_json_field "$third_payload" "allowed")
[ "$third_allowed" = "True" ] || [ "$third_allowed" = "true" ] || fail "third request should be allowed"

note "Attempting unsupported algorithm create (expect 422 in M1)"
unsupported_body="{\"name\":\"qa-unsupported-$(date +%s)\",\"algorithm\":\"token_bucket\",\"params_json\":{\"capacity\":10,\"refill_rate_per_sec\":1},\"enabled\":true}"
unsupported_result=$(request POST "${API_BASE}/policies" "$unsupported_body")
unsupported_status=$(printf '%s' "$unsupported_result" | sed -n '1p')
assert_http_status "$unsupported_status" "422" "unsupported algorithm create"

note "M1 smoke checks passed."
echo "[PASS] gateway M1 smoke suite"
