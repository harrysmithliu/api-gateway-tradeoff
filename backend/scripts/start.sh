#!/usr/bin/env sh
set -eu

echo "Running database migrations..."
alembic upgrade head

echo "Starting backend service on port ${API_PORT:-8000}..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${API_PORT:-8000}"
