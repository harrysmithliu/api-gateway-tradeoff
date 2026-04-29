from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from app.schemas.simulate import SimulateDecisionResponse


class LogListResponse(BaseModel):
    items: list[SimulateDecisionResponse]
    next_cursor: int
    limit: int
    run_id: UUID | None = None
