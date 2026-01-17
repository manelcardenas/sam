from fastapi import APIRouter, FastAPI
from mangum import Mangum

from backend.src.infra.adapters.repos import InMemoryRecipeRepository
from backend.src.infra.controllers import RecipeController


def create_app() -> FastAPI:
    app = FastAPI(title="Recipe API")

    # Initialize repository (will switch to DynamoDB in production)
    recipe_repository = InMemoryRecipeRepository()

    # Create router and register controllers
    router = APIRouter()
    RecipeController(recipe_repository, router)

    # Include router in app
    app.include_router(router)

    return app


# Create app instance
app = create_app()

# Lambda handler (used by AWS Lambda + API Gateway)
handler = Mangum(app)
