from fastapi import APIRouter

from app.core.db import check_db_health
from app.core.redis import check_redis_health

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, object]:
    db_ok = await check_db_health()
    redis_ok = await check_redis_health()
    status = "ok" if db_ok and redis_ok else "degraded"

    return {
        "status": status,
        "dependencies": {
            "postgres": "ok" if db_ok else "unreachable",
            "redis": "ok" if redis_ok else "unreachable",
        },
    }
