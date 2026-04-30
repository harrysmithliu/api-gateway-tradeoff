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

note "Checking gateway health"
health_result=$(request GET "${API_BASE}/health")
health_status=$(printf '%s' "$health_result" | sed -n '1p')
assert_http_status "$health_status" "200" "health"

name="qa-m2-sliding-$(date +%s)"
note "Creating sliding_log policy: ${name}"
create_body="{\"name\":\"${name}\",\"algorithm\":\"sliding_log\",\"params_json\":{\"window_size_sec\":3,\"limit\":2},\"enabled\":true,\"description\":\"qa smoke m2 sliding log\"}"
create_result=$(request POST "${API_BASE}/policies" "$create_body")
create_status=$(printf '%s' "$create_result" | sed -n '1p')
create_payload=$(printf '%s' "$create_result" | sed -n '2,$p')
assert_http_status "$create_status" "201" "create policy"
policy_id=$(extract_json_field "$create_payload" "id")
algorithm=$(extract_json_field "$create_payload" "algorithm")
[ "$algorithm" = "sliding_log" ] || fail "created policy algorithm mismatch"
note "Created policy id: ${policy_id}"

note "Activating policy with runtime reset"
activate_result=$(request POST "${API_BASE}/policies/${policy_id}/activate?reset_runtime_state=true")
activate_status=$(printf '%s' "$activate_result" | sed -n '1p')
assert_http_status "$activate_status" "200" "activate policy"

note "Simulate request #1 (expect 200)"
req_body='{"client_id":"qa-sl-client"}'
first_result=$(request POST "${API_BASE}/simulate/request" "$req_body")
first_status=$(printf '%s' "$first_result" | sed -n '1p')
first_payload=$(printf '%s' "$first_result" | sed -n '2,$p')
assert_http_status "$first_status" "200" "simulate request 1"
first_allowed=$(extract_json_field "$first_payload" "allowed")
[ "$first_allowed" = "True" ] || [ "$first_allowed" = "true" ] || fail "request #1 should be allowed"

note "Simulate request #2 (expect 200)"
second_result=$(request POST "${API_BASE}/simulate/request" "$req_body")
second_status=$(printf '%s' "$second_result" | sed -n '1p')
second_payload=$(printf '%s' "$second_result" | sed -n '2,$p')
assert_http_status "$second_status" "200" "simulate request 2"
second_allowed=$(extract_json_field "$second_payload" "allowed")
[ "$second_allowed" = "True" ] || [ "$second_allowed" = "true" ] || fail "request #2 should be allowed"

note "Simulate request #3 (expect 429)"
third_result=$(request POST "${API_BASE}/simulate/request" "$req_body")
third_status=$(printf '%s' "$third_result" | sed -n '1p')
third_payload=$(printf '%s' "$third_result" | sed -n '2,$p')
assert_http_status "$third_status" "429" "simulate request 3"
third_reason=$(extract_json_field "$third_payload" "reason")
[ "$third_reason" = "rate_limit_exceeded" ] || fail "request #3 reason mismatch"
third_retry=$(extract_json_field "$third_payload" "retry_after_ms")
if [ "$third_retry" -le 0 ]; then
  fail "request #3 retry_after_ms should be > 0"
fi

note "Sleeping 3.2s to let window slide"
sleep 3.2

note "Simulate request #4 after window slide (expect 200)"
fourth_result=$(request POST "${API_BASE}/simulate/request" "$req_body")
fourth_status=$(printf '%s' "$fourth_result" | sed -n '1p')
fourth_payload=$(printf '%s' "$fourth_result" | sed -n '2,$p')
assert_http_status "$fourth_status" "200" "simulate request 4"
fourth_allowed=$(extract_json_field "$fourth_payload" "allowed")
[ "$fourth_allowed" = "True" ] || [ "$fourth_allowed" = "true" ] || fail "request #4 should be allowed after window slide"

note "M2 sliding_log smoke checks passed."
echo "[PASS] gateway M2 sliding_log smoke suite"
