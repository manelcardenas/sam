from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from backend.src.app.use_cases import CreateRecipe, DeleteRecipe, GetRecipe, ListRecipes, UpdateRecipes
from backend.src.domain.entities import Recipe
from backend.src.domain.ports import RecipeRepository
from backend.src.infra.controllers.schemas import CreateRecipeRequest, UpdateRecipeRequest


class HealthResponse(BaseModel):
    status: str = Field(description="Service status")
    service: str = Field(description="Service name")


class RecipeController:
    def __init__(self, recipe_repository: RecipeRepository, router: APIRouter) -> None:
        self.recipe_repository = recipe_repository
        self.router = router
        self._register_routes()

    def _register_routes(self) -> None:
        # Health check
        self.router.add_api_route(
            "/health",
            self.health,
            methods=["GET"],
            response_model=HealthResponse,
            summary="Health check",
            description="Returns the health status of the recipe service",
            tags=["Health"],
        )

        # List all recipes
        self.router.add_api_route(
            "/recipes",
            self.list_recipes,
            methods=["GET"],
            response_model=list[Recipe],
            summary="List all recipes",
            description="Returns a list of all recipes",
            tags=["Recipes"],
        )

        # Create a new recipe
        self.router.add_api_route(
            "/recipes",
            self.create_recipe,
            methods=["POST"],
            response_model=Recipe,
            status_code=status.HTTP_201_CREATED,
            summary="Create a recipe",
            description="Creates a new recipe and returns it",
            tags=["Recipes"],
        )

        # Get a single recipe
        self.router.add_api_route(
            "/recipes/{recipe_id}",
            self.get_recipe,
            methods=["GET"],
            response_model=Recipe,
            summary="Get a recipe",
            description="Returns a single recipe by ID",
            tags=["Recipes"],
        )

        # Update a recipe
        self.router.add_api_route(
            "/recipes/{recipe_id}",
            self.update_recipe,
            methods=["PUT"],
            response_model=Recipe,
            summary="Update a recipe",
            description="Updates an existing recipe and returns it",
            tags=["Recipes"],
        )

        # Delete a recipe
        self.router.add_api_route(
            "/recipes/{recipe_id}",
            self.delete_recipe,
            methods=["DELETE"],
            status_code=status.HTTP_204_NO_CONTENT,
            summary="Delete a recipe",
            description="Deletes a recipe by ID",
            tags=["Recipes"],
        )

    @staticmethod
    def health() -> HealthResponse:
        """Health check endpoint."""
        return HealthResponse(status="ok", service="recipes")

    def list_recipes(self) -> list[Recipe]:
        """List all recipes."""
        use_case = ListRecipes(self.recipe_repository)
        return use_case.execute()

    def create_recipe(self, request: CreateRecipeRequest) -> Recipe:
        """Create a new recipe."""
        recipe = Recipe(**request.model_dump())
        use_case = CreateRecipe(self.recipe_repository)
        return use_case.execute(recipe)

    def get_recipe(self, recipe_id: str) -> Recipe:
        """Get a single recipe by ID."""
        use_case = GetRecipe(self.recipe_repository)
        recipe = use_case.execute(recipe_id)
        if recipe is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Recipe with id {recipe_id} not found")
        return recipe

    def update_recipe(self, recipe_id: str, request: UpdateRecipeRequest) -> Recipe:
        """Update an existing recipe."""
        # First check if recipe exists
        get_use_case = GetRecipe(self.recipe_repository)
        existing_recipe = get_use_case.execute(recipe_id)
        if existing_recipe is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Recipe with id {recipe_id} not found")

        # Update the recipe fields
        updated_recipe = Recipe(
            id=recipe_id,
            title=request.title,
            description=request.description,
            ingredients=request.ingredients,
            created_at=existing_recipe.created_at,
        )

        update_use_case = UpdateRecipes(self.recipe_repository)
        return update_use_case.execute(updated_recipe)

    def delete_recipe(self, recipe_id: str) -> None:
        use_case = DeleteRecipe(self.recipe_repository)
        try:
            use_case.execute(recipe_id)
        except KeyError as e:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
