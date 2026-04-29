from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

RunStatus = Literal["running", "completed", "failed"]


class RunCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    policy_id: UUID
    scenario_json: dict[str, Any]


class RunCompleteRequest(BaseModel):
    status: Literal["completed", "failed"] = "completed"


class RunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    policy_id: UUID
    scenario_json: dict[str, Any]
    started_at: datetime
    ended_at: datetime | None
    status: RunStatus
