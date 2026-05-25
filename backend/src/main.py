import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI
from mangum import Mangum

from src.infra.adapters.repos import PostgresRecipeRepository, PostgresUserRepository
from src.infra.controllers import RecipeController
from src.infra.db import DatabaseConnectionPool, build_dsn
from src.infra.security import configure_user_repository

# Load .env for local development. On Lambda, env vars are injected directly
# and no .env file exists — load_dotenv() is a safe no-op in that case.
load_dotenv()

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    db = DatabaseConnectionPool(dsn=build_dsn())

    # Lifespan: verify DB connection on startup, dispose engine on shutdown.
    # On Lambda this runs once per cold start via Mangum's lifespan support.
    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        db.open()
        yield
        db.close()

    app = FastAPI(title="Recipe API", lifespan=lifespan)

    recipe_repository = PostgresRecipeRepository(session_factory=db.session_factory)
    user_repository = PostgresUserRepository(session_factory=db.session_factory)
    configure_user_repository(user_repository)

    router = APIRouter()
    RecipeController(recipe_repository, router)
    app.include_router(router)

    return app


app = create_app()

# Lambda handler — wraps the ASGI app for API Gateway / Function URLs.
handler = Mangum(app)
