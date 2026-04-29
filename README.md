# API Gateway Rate Limiter Simulator

An industry-style, minimum-runnable simulation platform for comparing API gateway rate-limiting algorithms under controlled load.

## Project Description

This project provides an end-to-end environment to evaluate the behavior of five rate-limiting algorithms in a unified dashboard:

- Fixed Window
- Sliding Log
- Sliding Window Counter
- Token Bucket
- Leaky Bucket

The system is designed to make algorithm trade-offs visible through live request simulation, policy hot-switching, real-time metrics, and request-level logs.

## Architecture Overview

- **Backend**: FastAPI service with pluggable limiter engines
- **Runtime State**: Redis for counters, tokens, windows, and short-term metrics/log buffers
- **Policy Storage**: PostgreSQL for policy definitions, parameters, activation state, and optional experiment metadata
- **Frontend**: React + Vite dashboard for policy control, simulation orchestration, KPI cards, charting, and log inspection
- **Deployment**: Docker Compose for one-command local startup

## Core Goals

- Hot-switch active rate-limiting policy without restarting the backend
- Simulate configurable traffic rounds and burst patterns
- Visualize QPS, reject rate, and latency percentiles (including P99) in near real time
- Compare algorithm behavior under the same traffic profile

## Planned Repository Structure

```text
backend/     FastAPI app, limiters, services, migrations, tests
frontend/    React dashboard and simulation UI
infra/       Docker Compose and infrastructure wiring
```

## Implementation Contract

The implementation details, API contracts, data model, milestone criteria, and delivery checklist are defined in `IMPLEMENTATION_BLUEPRINT.md`.

## Status

Repository initialized with blueprint and baseline project metadata.

