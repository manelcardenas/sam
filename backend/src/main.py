import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI
from mangum import Mangum

from src.infra.adapters.parsing import build_ingredient_parser
from src.infra.adapters.places import GeoapifyPlacesProvider, resolve_geoapify_api_key
from src.infra.adapters.repos import (
    PostgresCuisineRepository,
    PostgresGroceryRepository,
    PostgresKitchenRepository,
    PostgresMealPlanRepository,
    PostgresRecipeRepository,
    PostgresRestaurantRepository,
    PostgresReviewRepository,
    PostgresUserRepository,
)
from src.infra.controllers import GroceryController, KitchenController, MealPlanController, PlacesController, RecipeController, RestaurantController, UserController
from src.infra.db import DatabaseConnectionPool, build_dsn
from src.infra.middleware import (
    CORSMiddlewareConfigurator,
    MiddlewareSettings,
    RateLimitMiddleware,
    RequestTimingMiddleware,
)
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
    # Added last, so it runs outermost and its `ms` covers everything the other
    # middleware do — including a 429 or a rejected preflight.
    app.add_middleware(RequestTimingMiddleware)

    recipe_repository = PostgresRecipeRepository(session_factory=db.session_factory)
    user_repository = PostgresUserRepository(session_factory=db.session_factory)
    restaurant_repository = PostgresRestaurantRepository(session_factory=db.session_factory)
    review_repository = PostgresReviewRepository(session_factory=db.session_factory)
    cuisine_repository = PostgresCuisineRepository(session_factory=db.session_factory)
    meal_plan_repository = PostgresMealPlanRepository(session_factory=db.session_factory)
    kitchen_repository = PostgresKitchenRepository(session_factory=db.session_factory)
    grocery_repository = PostgresGroceryRepository(session_factory=db.session_factory)
    configure_user_repository(user_repository)

    # Key resolved once per cold start (SSM on Lambda, .env locally). A missing
    # key doesn't block startup — /places/* then answers 503, everything else works.
    places_provider = GeoapifyPlacesProvider(api_key=resolve_geoapify_api_key())

    router = APIRouter()
    RecipeController(recipe_repository, router)
    UserController(user_repository, review_repository, router)
    RestaurantController(restaurant_repository, review_repository, cuisine_repository, router)
    PlacesController(places_provider, router)
    # One parser for both consumers: the recipe box and the list's background
    # aisle lookup. Built once so a cold start resolves the key from SSM once.
    ingredient_parser = build_ingredient_parser()
    MealPlanController(meal_plan_repository, kitchen_repository, grocery_repository, ingredient_parser, router)
    KitchenController(kitchen_repository, user_repository, router)
    GroceryController(grocery_repository, recipe_repository, ingredient_parser, router)
    app.include_router(router)

    return app


app = create_app()

# Lambda handler — wraps the ASGI app for API Gateway / Function URLs.
handler = Mangum(app)


def seed() -> None:
    """Local dev entrypoint (`uv run seed`): (re)seed the local DB. Idempotent."""
    from scripts.seed import run
    from scripts.seed_grocery import run as run_grocery

    run_grocery()  # reference data — the vocabulary the shopping list sorts by
    run()


def serve() -> None:
    """Local dev entrypoint (`uv run start`): migrate + seed, then serve with reload.

    Production never calls this — Lambda uses the Mangum `handler` above.

    These imports MUST stay local. Importing them at module top runs on every
    Lambda cold start, and `from alembic import command` actually CRASHES there:
    the bundled `alembic/` migrations directory shadows the installed alembic
    library (`ImportError: cannot import name 'command' from 'alembic'`).
    """
    import os

    import uvicorn
    from alembic import command
    from alembic.config import Config

    from scripts.seed import run
    from scripts.seed_grocery import run as run_grocery

    command.upgrade(Config("alembic.ini"), "head")  # apply pending migrations
    # Both idempotent. Grocery first: it is *reference* data every environment
    # needs, where `run()` below is a local dev fixture — and a recipe seeded
    # before the vocabulary exists would have nothing to resolve against.
    run_grocery()
    run()  # loads the demo recipes, the dine fixture, and both seed users

    uvicorn.run(
        "src.main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "9000")),
        reload=True,
    )
