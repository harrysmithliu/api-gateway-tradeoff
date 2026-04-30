# Classic API Gateway (Go, Incremental Backend)

This gateway is fully implemented in Go for high-concurrency production-style workloads.

## Current Milestone
- M1: Fixed Window only

Implemented:
- PostgreSQL-backed policy configuration and activation
- Redis-backed fixed-window runtime state
- Classic `/api/*` gateway proxy with pre-forward rate limiting
- Stable management APIs for policy lifecycle and simulation
- Runtime reset (`activate?reset_runtime_state=true`)

Not implemented in M1:
- Sliding Log
- Sliding Window Counter
- Token Bucket
- Leaky Bucket

## Go Project Layout
- `cmd/gateway/main.go`: process bootstrap and HTTP server lifecycle
- `internal/config`: env config loader
- `internal/db`: Postgres pool and schema bootstrap
- `internal/runtime`: Redis runtime store
- `internal/limiter/fixed_window.go`: fixed-window core logic (standalone file)
- `internal/limiter/factory.go`: algorithm switch point for future expansion
- `internal/policy`: policy service (CRUD/activate/active)
- `internal/simulate`: limiter evaluation service
- `internal/proxy`: upstream resolution and forwarding
- `internal/httpapi`: HTTP handlers and routing

## Stable Management APIs
- `POST /api/policies`
- `PUT /api/policies/{id}`
- `POST /api/policies/{id}/activate`
- `GET /api/policies/active`
- `POST /api/simulate/request`
- `GET /api/health`

## Local Run
```bash
go test ./...
GATEWAY_PORT=8000 \
POSTGRES_DSN=postgresql://postgres:postgres@localhost:5432/rate_limiter \
REDIS_URL=redis://localhost:6379/0 \
go run ./cmd/gateway
```

## Docker Run
```bash
docker compose up -d --build postgres redis gateway
```
