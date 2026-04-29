from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.schemas.policy import AlgorithmType


class SimulateRequestPayload(BaseModel):
    client_id: str
    run_id: UUID | None = None


class SimulateDecisionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    request_id: UUID
    ts: datetime
    policy_id: UUID
    algorithm: AlgorithmType
    allowed: bool
    reason: str | None = None
    retry_after_ms: int | None = None
    latency_ms: int
    remaining: int | None = None
    run_id: UUID | None = None
    algorithm_state: dict[str, Any] | None = None
