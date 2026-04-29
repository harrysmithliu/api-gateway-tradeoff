from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db_session
from app.core.redis import get_redis_client
from app.schemas.policy import PolicyCreateRequest, PolicyResponse, PolicyUpdateRequest
from app.services.policy_service import PolicyService

router = APIRouter(prefix="/policies", tags=["policies"])


async def get_policy_service(
    db: AsyncSession = Depends(get_db_session),
    redis_client: Redis = Depends(get_redis_client),
) -> PolicyService:
    return PolicyService(db, redis_client)


@router.get("", response_model=list[PolicyResponse])
async def list_policies(service: PolicyService = Depends(get_policy_service)) -> list[PolicyResponse]:
    policies = await service.list_policies()
    return [PolicyResponse.model_validate(policy) for policy in policies]


@router.post("", response_model=PolicyResponse, status_code=status.HTTP_201_CREATED)
async def create_policy(
    payload: PolicyCreateRequest,
    service: PolicyService = Depends(get_policy_service),
) -> PolicyResponse:
    policy = await service.create_policy(payload)
    return PolicyResponse.model_validate(policy)


@router.put("/{policy_id}", response_model=PolicyResponse)
async def update_policy(
    policy_id: UUID,
    payload: PolicyUpdateRequest,
    service: PolicyService = Depends(get_policy_service),
) -> PolicyResponse:
    policy = await service.update_policy(policy_id, payload)
    return PolicyResponse.model_validate(policy)


@router.post("/{policy_id}/activate", response_model=PolicyResponse)
async def activate_policy(
    policy_id: UUID,
    reset_runtime_state: bool = Query(default=False),
    service: PolicyService = Depends(get_policy_service),
) -> PolicyResponse:
    policy = await service.activate_policy(policy_id, reset_runtime_state=reset_runtime_state)
    return PolicyResponse.model_validate(policy)


@router.get("/active", response_model=PolicyResponse)
async def get_active_policy(service: PolicyService = Depends(get_policy_service)) -> PolicyResponse:
    policy = await service.get_active_policy()
    return PolicyResponse.model_validate(policy)
