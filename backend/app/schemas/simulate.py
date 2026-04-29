from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.policy import AlgorithmType


class SimulateRequestPayload(BaseModel):
    client_id: str
    run_id: UUID | None = None


class SimulateBurstPayload(BaseModel):
    total_requests: int = Field(gt=0, le=1000)
    client_id_mode: Literal["single", "rotating"] = "single"
    client_id: str = Field(default="client-a", min_length=1)
    rotate_pool_size: int = Field(default=10, gt=0, le=1000)
    interval_ms: int = Field(default=0, ge=0, le=60_000)
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
    client_id: str
    algorithm_state: dict[str, Any] | None = None


class SimulateBurstResponse(BaseModel):
    total: int
    allowed: int
    rejected: int
    decisions: list[SimulateDecisionResponse]
