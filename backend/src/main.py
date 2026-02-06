import os

from fastapi import APIRouter, FastAPI
from mangum import Mangum

from src.infra.adapters.repos import DynamoDBRecipeRepository, InMemoryRecipeRepository
from src.infra.controllers import RecipeController


def create_app() -> FastAPI:
    app = FastAPI(title="Recipe API")

    # Initialize repository based on environment variable
    use_dynamodb = os.getenv("USE_DYNAMODB", "false").lower() == "true"
    if use_dynamodb:
        recipe_repository = DynamoDBRecipeRepository()
    else:
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
