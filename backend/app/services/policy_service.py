from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.active_policy import ActivePolicy
from app.models.policy import RateLimitPolicy
from app.schemas.policy import (
    PolicyCreateRequest,
    PolicyUpdateRequest,
    validate_policy_params,
)


class PolicyService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_policies(self) -> list[RateLimitPolicy]:
        result = await self.session.execute(
            select(RateLimitPolicy).order_by(RateLimitPolicy.created_at.desc())
        )
        return list(result.scalars().all())

    async def create_policy(self, payload: PolicyCreateRequest) -> RateLimitPolicy:
        normalized_params = self._validate_params_or_422(payload.algorithm, payload.params_json)
        policy = RateLimitPolicy(
            name=payload.name,
            algorithm=payload.algorithm,
            params_json=normalized_params,
            enabled=payload.enabled,
            description=payload.description,
        )
        self.session.add(policy)

        try:
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Policy name already exists.",
            ) from exc

        await self.session.refresh(policy)
        return policy

    async def update_policy(self, policy_id: UUID, payload: PolicyUpdateRequest) -> RateLimitPolicy:
        policy = await self.session.get(RateLimitPolicy, policy_id)
        if policy is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Policy not found.")

        has_algorithm_update = "algorithm" in payload.model_fields_set
        has_params_update = "params_json" in payload.model_fields_set
        has_name_update = "name" in payload.model_fields_set
        has_enabled_update = "enabled" in payload.model_fields_set
        has_description_update = "description" in payload.model_fields_set

        algorithm = payload.algorithm or policy.algorithm
        params = payload.params_json if has_params_update else policy.params_json

        if has_params_update and payload.params_json is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="params_json cannot be null when provided.",
            )
        if has_name_update and payload.name is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="name cannot be null when provided.",
            )
        if has_algorithm_update and payload.algorithm is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="algorithm cannot be null when provided.",
            )
        if has_enabled_update and payload.enabled is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="enabled cannot be null when provided.",
            )

        if has_algorithm_update or has_params_update:
            policy.algorithm = algorithm
            policy.params_json = self._validate_params_or_422(algorithm, params)

        if has_name_update:
            policy.name = payload.name
        if has_enabled_update:
            policy.enabled = payload.enabled
        if has_description_update:
            policy.description = payload.description

        policy.version += 1
        policy.updated_at = datetime.now(timezone.utc)

        try:
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Policy name already exists.",
            ) from exc

        await self.session.refresh(policy)
        return policy

    async def activate_policy(self, policy_id: UUID, reset_runtime_state: bool = False) -> RateLimitPolicy:
        policy = await self.session.get(RateLimitPolicy, policy_id)
        if policy is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Policy not found.")
        if not policy.enabled:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Disabled policy cannot be activated.",
            )

        active = await self.session.get(ActivePolicy, 1)
        if active is None:
            active = ActivePolicy(id=1, policy_id=policy.id)
            self.session.add(active)
        else:
            active.policy_id = policy.id
            active.updated_at = datetime.now(timezone.utc)

        # Runtime state reset will be handled when limiter state service is implemented.
        _ = reset_runtime_state

        await self.session.commit()
        return policy

    async def get_active_policy(self) -> RateLimitPolicy:
        active = await self.session.get(ActivePolicy, 1)
        if active is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No active policy configured.",
            )

        policy = await self.session.get(RateLimitPolicy, active.policy_id)
        if policy is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Active policy target does not exist.",
            )

        return policy

    @staticmethod
    def _validate_params_or_422(algorithm: str, params_json: dict[str, object]) -> dict[str, object]:
        try:
            return validate_policy_params(algorithm, params_json)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid params_json for algorithm '{algorithm}': {exc}",
            ) from exc
