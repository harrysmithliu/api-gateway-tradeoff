# QA Agent Execution Guide (Gateway M1, Go)

Last updated: 2026-04-29

## Purpose
This runbook validates the Go-based `gateway/` backend for milestone M1.

M1 scope:
- PostgreSQL-configured policies
- Redis-backed fixed-window limiter
- Active policy switching
- Runtime reset on activation
- Simulation endpoint behavior

Out of scope:
- Sliding Log, Sliding Window Counter, Token Bucket, Leaky Bucket implementations
- Frontend assertions

## Preconditions
- Run from repo root:
  - `/Users/harryliu/Documents/workspace/portfolio/pj-api-gateway/api-gateway-tradeoff`
- Docker daemon available
- Ports available: `8000`, `5432`, `6379`

## Boot Services
```bash
docker compose up -d --build --remove-orphans postgres redis gateway
```

## Health Check
```bash
curl -sS http://localhost:8000/api/health
```
Expected:
- HTTP 200
- `status=ok` for final pass

## Primary Automated Smoke
```bash
./gateway/scripts/qa_smoke_m1.sh
```

Optional base URL override:
```bash
BASE_URL=http://localhost:8000 ./gateway/scripts/qa_smoke_m1.sh
```

Expected final line:
```text
[PASS] gateway M1 smoke suite
```

## Unit + API Tests (Go)
From `gateway/`:
```bash
docker run --rm -v "$PWD":/src -w /src golang:1.24 bash -lc 'go test ./...'
```

Expected:
- Fixed-window unit tests pass
- HTTP-level integration tests pass

## Manual Targeted Checks
1. Active policy:
```bash
curl -sS http://localhost:8000/api/policies/active
```

2. Simulate request:
```bash
curl -sS -X POST http://localhost:8000/api/simulate/request \
  -H 'Content-Type: application/json' \
  -d '{"client_id":"manual-qa"}'
```

3. Status semantics:
- Allow path => `200`
- Reject path => `429`

## Failure Triage
- Service state:
```bash
docker compose ps
```
- Gateway logs:
```bash
docker compose logs --tail=200 gateway
```
- DB/Redis dependency issues usually show up in `/api/health` and container logs.

## M1 Pass Criteria
All true:
- Smoke script passes.
- Go tests pass.
- Fixed-window limit/retry behavior is correct.
- Unsupported algorithms are rejected in M1 policy validation.
