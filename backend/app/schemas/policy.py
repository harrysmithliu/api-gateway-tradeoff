from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

AlgorithmType = Literal[
    "fixed_window",
    "sliding_log",
    "sliding_window_counter",
    "token_bucket",
    "leaky_bucket",
]


class FixedWindowParams(BaseModel):
    window_size_sec: int = Field(gt=0)
    limit: int = Field(gt=0)


class SlidingLogParams(BaseModel):
    window_size_sec: int = Field(gt=0)
    limit: int = Field(gt=0)


class SlidingWindowCounterParams(BaseModel):
    window_size_sec: int = Field(gt=0)
    limit: int = Field(gt=0)


class TokenBucketParams(BaseModel):
    capacity: int = Field(gt=0)
    refill_rate_per_sec: float = Field(gt=0)
    tokens_per_request: int = Field(default=1, gt=0)


class LeakyBucketParams(BaseModel):
    capacity: int = Field(gt=0)
    leak_rate_per_sec: float = Field(gt=0)
    water_per_request: int = Field(default=1, gt=0)


PARAMETER_SCHEMA_BY_ALGORITHM = {
    "fixed_window": FixedWindowParams,
    "sliding_log": SlidingLogParams,
    "sliding_window_counter": SlidingWindowCounterParams,
    "token_bucket": TokenBucketParams,
    "leaky_bucket": LeakyBucketParams,
}


def validate_policy_params(algorithm: AlgorithmType, params_json: dict[str, Any]) -> dict[str, Any]:
    schema_model = PARAMETER_SCHEMA_BY_ALGORITHM.get(algorithm)
    if schema_model is None:
        raise ValueError(f"Unsupported algorithm '{algorithm}'")
    validated = schema_model.model_validate(params_json)
    return validated.model_dump()


class PolicyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    algorithm: AlgorithmType
    params_json: dict[str, Any]
    enabled: bool = True
    description: str | None = None


class PolicyUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    algorithm: AlgorithmType | None = None
    params_json: dict[str, Any] | None = None
    enabled: bool | None = None
    description: str | None = None


class PolicyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    algorithm: AlgorithmType
    params_json: dict[str, Any]
    enabled: bool
    version: int
    description: str | None
    created_at: datetime
    updated_at: datetime
