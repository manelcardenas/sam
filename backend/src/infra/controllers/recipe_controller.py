from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from src.app.use_cases import CreateRecipe, DeleteRecipe, GetRecipe, ListRecipes, UpdateRecipe
from src.domain.entities import Recipe
from src.domain.ports import RecipeRepository
from src.infra.controllers.schemas import CreateRecipeRequest, UpdateRecipeRequest
from src.infra.security import TokenPayload, get_current_user


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
            dependencies=[Depends(get_current_user)],
            summary="List recipes",
            description="Returns every recipe. `mine=true` narrows to the caller",
            tags=["Recipes"],
        )

        # Create a new recipe
        self.router.add_api_route(
            "/recipes",
            self.create_recipe,
            methods=["POST"],
            response_model=Recipe,
            dependencies=[Depends(get_current_user)],
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
            dependencies=[Depends(get_current_user)],
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
            dependencies=[Depends(get_current_user)],
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
            dependencies=[Depends(get_current_user)],
            summary="Delete a recipe",
            description="Deletes a recipe by ID",
            tags=["Recipes"],
        )

    @staticmethod
    def health() -> HealthResponse:
        """Health check endpoint."""
        return HealthResponse(status="ok", service="recipes")

    def list_recipes(
        self,
        mine: bool = False,
        current_user: TokenPayload = Depends(get_current_user),
    ) -> list[Recipe]:
        """List recipes. `?mine=true` narrows to the caller.

        A query param on the existing route rather than a new endpoint, so no
        API Gateway route has to be added.
        """
        use_case = ListRecipes(self.recipe_repository)
        return use_case.execute(created_by=current_user.sub if mine else None)

    def create_recipe(self, request: CreateRecipeRequest, current_user: TokenPayload = Depends(get_current_user)) -> Recipe:
        """Create a new recipe. `created_by` is injected from the JWT sub claim."""
        recipe_data = request.model_dump(exclude={"created_by"})
        # HttpUrl validates the input but the domain entity stores a plain str.
        recipe_data["source_url"] = str(request.source_url) if request.source_url else None
        recipe = Recipe(**recipe_data, created_by=current_user.sub)
        use_case = CreateRecipe(self.recipe_repository)
        return use_case.execute(recipe)

    def get_recipe(self, recipe_id: str, _current_user: TokenPayload = Depends(get_current_user)) -> Recipe:
        """Get a single recipe by ID."""
        use_case = GetRecipe(self.recipe_repository)
        recipe = use_case.execute(recipe_id)
        if recipe is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Recipe with id {recipe_id} not found")
        return recipe

    def update_recipe(self, recipe_id: str, request: UpdateRecipeRequest, current_user: TokenPayload = Depends(get_current_user)) -> Recipe:
        """Update an existing recipe. Only the recipe's creator may update it."""
        # First check if recipe exists
        get_use_case = GetRecipe(self.recipe_repository)
        existing_recipe = get_use_case.execute(recipe_id)
        if existing_recipe is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Recipe with id {recipe_id} not found")
        if existing_recipe.created_by != current_user.sub:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the recipe's creator can update it")

        # Update the recipe fields
        updated_recipe = Recipe(
            id=recipe_id,
            title=request.title,
            instructions=request.instructions,
            ingredients=request.ingredients.model_dump(),
            food_type=request.food_type,
            # HttpUrl validates the input but the domain entity stores a plain str.
            source_url=str(request.source_url) if request.source_url else None,
            prep_time_minutes=request.prep_time_minutes,
            cook_time_minutes=request.cook_time_minutes,
            created_by=existing_recipe.created_by,
            created_at=existing_recipe.created_at,
        )

        update_use_case = UpdateRecipe(self.recipe_repository)
        return update_use_case.execute(updated_recipe)

    def delete_recipe(self, recipe_id: str, current_user: TokenPayload = Depends(get_current_user)) -> None:
        """Delete a recipe. Only the recipe's creator may delete it."""
        get_use_case = GetRecipe(self.recipe_repository)
        existing_recipe = get_use_case.execute(recipe_id)
        if existing_recipe is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Recipe with id {recipe_id} not found")
        if existing_recipe.created_by != current_user.sub:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the recipe's creator can delete it")

        use_case = DeleteRecipe(self.recipe_repository)
        try:
            use_case.execute(recipe_id)
        except KeyError as e:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
