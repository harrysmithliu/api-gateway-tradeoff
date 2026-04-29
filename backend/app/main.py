from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health_routes import router as health_router
from app.api.log_routes import router as log_router
from app.api.metrics_routes import router as metrics_router
from app.api.policy_routes import router as policy_router
from app.api.run_routes import router as run_router
from app.api.simulate_routes import router as simulate_router
from app.core.config import settings


def create_app() -> FastAPI:
    app = FastAPI(
        title="API Gateway Tradeoff Backend",
        version="0.1.0",
    )

    allowed_origins = [origin.strip() for origin in settings.cors_allowed_origins.split(",") if origin.strip()]
    if not allowed_origins:
        allowed_origins = ["*"]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router, prefix="/api")
    app.include_router(log_router, prefix="/api")
    app.include_router(metrics_router, prefix="/api")
    app.include_router(policy_router, prefix="/api")
    app.include_router(run_router, prefix="/api")
    app.include_router(simulate_router, prefix="/api")

    @app.get("/")
    async def root() -> dict[str, str]:
        return {
            "service": "api-gateway-tradeoff-backend",
            "environment": settings.environment,
        }

    return app


app = create_app()
