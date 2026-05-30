import logging
import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import uvicorn
from alembic import command
from alembic.config import Config
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI
from mangum import Mangum
from scripts.seed import run as seed_db

from src.infra.adapters.repos import PostgresRecipeRepository, PostgresUserRepository
from src.infra.controllers import RecipeController, UserController
from src.infra.db import DatabaseConnectionPool, build_dsn
from src.infra.middleware import CORSMiddlewareConfigurator, MiddlewareSettings, RateLimitMiddleware
from src.infra.security import configure_user_repository

# Load .env for local development. On Lambda, env vars are injected directly
# and no .env file exists — load_dotenv() is a safe no-op in that case.
load_dotenv()

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    db = DatabaseConnectionPool(dsn=build_dsn())
    settings = MiddlewareSettings()

    # Lifespan: verify DB connection on startup, dispose engine on shutdown.
    # On Lambda this runs once per cold start via Mangum's lifespan support.
    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        db.open()
        yield
        db.close()

    app = FastAPI(title="Recipe API", lifespan=lifespan)

    # Middleware order: add rate limiting first so CORS wraps it — this keeps
    # preflight OPTIONS un-throttled and ensures 429 responses still carry CORS
    # headers (the most recently added middleware runs outermost).
    if settings.rate_limit_per_minute > 0:
        app.add_middleware(RateLimitMiddleware, limit_per_minute=settings.rate_limit_per_minute)
    CORSMiddlewareConfigurator(settings).apply(app)

    recipe_repository = PostgresRecipeRepository(session_factory=db.session_factory)
    user_repository = PostgresUserRepository(session_factory=db.session_factory)
    configure_user_repository(user_repository)

    router = APIRouter()
    RecipeController(recipe_repository, router)
    UserController(user_repository, router)
    app.include_router(router)

    return app


app = create_app()

# Lambda handler — wraps the ASGI app for API Gateway / Function URLs.
handler = Mangum(app)


def seed() -> None:
    """Local dev entrypoint (`uv run seed`): (re)seed the local DB. Idempotent."""
    seed_db()


def serve() -> None:
    """Local dev entrypoint (`uv run start`): migrate + seed, then serve with reload."""
    command.upgrade(Config("alembic.ini"), "head")  # apply pending migrations
    seed_db()  # idempotent — loads the demo recipes + seed user

    uvicorn.run(
        "src.main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "9000")),
        reload=True,
    )
