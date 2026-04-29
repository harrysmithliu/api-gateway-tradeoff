from __future__ import annotations

import json
from uuid import UUID

from redis.asyncio import Redis

from app.schemas.simulate import SimulateDecisionResponse


class LogService:
    def __init__(self, redis_client: Redis):
        self.redis_client = redis_client

    async def list_logs(
        self,
        cursor: int,
        limit: int,
        run_id: UUID | None,
        rejected_only: bool,
    ) -> tuple[list[SimulateDecisionResponse], int]:
        key = f"logs:run:{run_id}" if run_id is not None else "logs:global"

        start = max(cursor, 0)
        page_limit = max(limit, 1)

        if not rejected_only:
            end = start + page_limit - 1
            values = await self.redis_client.lrange(key, start, end)
            items = [SimulateDecisionResponse.model_validate(json.loads(raw)) for raw in values]
            next_cursor = start + len(values)
            return items, next_cursor

        total = int(await self.redis_client.llen(key))
        if start >= total:
            return [], start

        items: list[SimulateDecisionResponse] = []
        position = start
        chunk_size = max(page_limit * 3, 50)

        while position < total and len(items) < page_limit:
            end = min(position + chunk_size - 1, total - 1)
            values = await self.redis_client.lrange(key, position, end)
            if not values:
                break

            for offset, raw in enumerate(values):
                parsed = SimulateDecisionResponse.model_validate(json.loads(raw))
                if not parsed.allowed:
                    items.append(parsed)
                    if len(items) >= page_limit:
                        next_cursor = position + offset + 1
                        return items, next_cursor

            position += len(values)

        return items, position
