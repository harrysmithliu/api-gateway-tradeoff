#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
API_BASE="${BASE_URL%/}/api"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

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

note "Checking health before consistency case"
health_result=$(request GET "${API_BASE}/health")
health_status=$(printf '%s' "$health_result" | sed -n '1p')
assert_http_status "$health_status" "200" "health"

fixed_name="qa-consistency-fixed-$(date +%s)"
note "Creating baseline fixed_window policy: ${fixed_name}"
fixed_body="{\"name\":\"${fixed_name}\",\"algorithm\":\"fixed_window\",\"params_json\":{\"window_size_sec\":30,\"limit\":5},\"enabled\":true}"
fixed_create_result=$(request POST "${API_BASE}/policies" "$fixed_body")
fixed_create_status=$(printf '%s' "$fixed_create_result" | sed -n '1p')
fixed_create_payload=$(printf '%s' "$fixed_create_result" | sed -n '2,$p')
assert_http_status "$fixed_create_status" "201" "create fixed policy"
fixed_id=$(extract_json_field "$fixed_create_payload" "id")

note "Activating baseline fixed_window policy"
fixed_activate_result=$(request POST "${API_BASE}/policies/${fixed_id}/activate?reset_runtime_state=false")
fixed_activate_status=$(printf '%s' "$fixed_activate_result" | sed -n '1p')
assert_http_status "$fixed_activate_status" "200" "activate fixed policy"

candidate_name="qa-consistency-sliding-$(date +%s)"
note "Creating candidate sliding_log policy: ${candidate_name}"
candidate_body="{\"name\":\"${candidate_name}\",\"algorithm\":\"sliding_log\",\"params_json\":{\"window_size_sec\":30,\"limit\":5},\"enabled\":true}"
candidate_create_result=$(request POST "${API_BASE}/policies" "$candidate_body")
candidate_create_status=$(printf '%s' "$candidate_create_result" | sed -n '1p')
candidate_create_payload=$(printf '%s' "$candidate_create_result" | sed -n '2,$p')
assert_http_status "$candidate_create_status" "201" "create sliding policy"
candidate_id=$(extract_json_field "$candidate_create_payload" "id")

note "Stopping redis to force reset failure"
docker compose -f "${ROOT_DIR}/docker-compose.yml" stop redis >/dev/null

note "Attempt activate candidate with reset_runtime_state=true (expect 500)"
set +e
failed_activate_result=$(request POST "${API_BASE}/policies/${candidate_id}/activate?reset_runtime_state=true")
failed_activate_status=$(printf '%s' "$failed_activate_result" | sed -n '1p')
set -e
assert_http_status "$failed_activate_status" "500" "activate candidate with redis down"

note "Starting redis back"
docker compose -f "${ROOT_DIR}/docker-compose.yml" start redis >/dev/null
sleep 2

note "Read active policy after failed reset activation"
active_result=$(request GET "${API_BASE}/policies/active")
active_status=$(printf '%s' "$active_result" | sed -n '1p')
active_payload=$(printf '%s' "$active_result" | sed -n '2,$p')
assert_http_status "$active_status" "200" "get active policy after failure"
active_id=$(extract_json_field "$active_payload" "id")

if [ "$active_id" != "$fixed_id" ]; then
  fail "active policy changed unexpectedly after failed reset activation (expected ${fixed_id}, got ${active_id})"
fi

note "Consistency validated: active policy unchanged when reset failed."
echo "[PASS] activate+reset consistency failure-path check"
