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

name="qa-m5-leaky-$(date +%s)"
note "Creating leaky_bucket policy: ${name}"
create_body="{\"name\":\"${name}\",\"algorithm\":\"leaky_bucket\",\"params_json\":{\"capacity\":4,\"leak_rate_per_sec\":1.5,\"water_per_request\":2},\"enabled\":true,\"description\":\"qa smoke m5 leaky bucket\"}"
create_result=$(request POST "${API_BASE}/policies" "$create_body")
create_status=$(printf '%s' "$create_result" | sed -n '1p')
create_payload=$(printf '%s' "$create_result" | sed -n '2,$p')
assert_http_status "$create_status" "201" "create policy"
policy_id=$(extract_json_field "$create_payload" "id")
algorithm=$(extract_json_field "$create_payload" "algorithm")
[ "$algorithm" = "leaky_bucket" ] || fail "created policy algorithm mismatch"

note "Activating policy with runtime reset"
activate_result=$(request POST "${API_BASE}/policies/${policy_id}/activate?reset_runtime_state=true")
activate_status=$(printf '%s' "$activate_result" | sed -n '1p')
assert_http_status "$activate_status" "200" "activate policy"

req_body='{"client_id":"qa-lb-client"}'

note "Simulate request #1 (expect 200)"
first_result=$(request POST "${API_BASE}/simulate/request" "$req_body")
first_status=$(printf '%s' "$first_result" | sed -n '1p')
first_payload=$(printf '%s' "$first_result" | sed -n '2,$p')
assert_http_status "$first_status" "200" "simulate request 1"
first_algo=$(extract_json_field "$first_payload" "algorithm")
[ "$first_algo" = "leaky_bucket" ] || fail "simulate #1 algorithm mismatch"

for field in count window_start_ms window_size_sec state_schema_version water_level capacity leak_rate_per_sec water_per_request last_leak_ms; do
  extract_json_field "$first_payload" "algorithm_state.${field}" >/dev/null || fail "simulate #1 missing algorithm_state.${field}"
done

note "Triggering burst and expecting at least one 429 in requests #2-#6"
blocked_seen=0
for i in 2 3 4 5 6; do
  req_result=$(request POST "${API_BASE}/simulate/request" "$req_body")
  req_status=$(printf '%s' "$req_result" | sed -n '1p')
  req_payload=$(printf '%s' "$req_result" | sed -n '2,$p')
  if [ "$req_status" = "429" ]; then
    req_reason=$(extract_json_field "$req_payload" "reason")
    [ "$req_reason" = "rate_limit_exceeded" ] || fail "simulate #${i} reason mismatch"
    req_retry=$(extract_json_field "$req_payload" "retry_after_ms")
    if [ "$req_retry" -le 0 ]; then
      fail "simulate #${i} retry_after_ms should be > 0"
    fi
    blocked_seen=1
    break
  fi
done

if [ "$blocked_seen" -ne 1 ]; then
  fail "expected at least one 429 in requests #2-#6"
fi

note "Sleeping 1.8s to allow leak-out"
sleep 1.8

note "Simulate request after leak-out (expect 200)"
after_result=$(request POST "${API_BASE}/simulate/request" "$req_body")
after_status=$(printf '%s' "$after_result" | sed -n '1p')
assert_http_status "$after_status" "200" "simulate request after leak-out"

note "M5 leaky_bucket smoke checks passed."
echo "[PASS] gateway M5 leaky_bucket smoke suite"
