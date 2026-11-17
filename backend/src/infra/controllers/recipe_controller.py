from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from src.app.use_cases import CreateRecipe, DeleteRecipe, GetRecipe, ListRecipes, RememberGroceries, UpdateRecipe
from src.domain.entities import Ingredient, Ingredients, ProposedGroceryItem, Recipe, Viewer, Visibility
from src.domain.ports import GroceryRepository, KitchenRepository, RecipeRepository
from src.infra.controllers.schemas import CreateRecipeRequest, UpdateRecipeRequest
from src.infra.controllers.schemas.recipe import IngredientsInput
from src.infra.security import TokenPayload, get_current_user


class HealthResponse(BaseModel):
    status: str = Field(description="Service status")
    service: str = Field(description="Service name")


def _split(ingredients: IngredientsInput) -> tuple[Ingredients, list[ProposedGroceryItem]]:
    """What the recipe stores, and what the vocabulary should learn from it.

    The proposal rides on the row only while the person reviews; the recipe keeps
    the name, as every ingredient always has (ADR-0009 §8).
    """
    items = [Ingredient(name=item.name, amount=item.amount, unit=item.unit, optional=item.optional) for item in ingredients.items]
    proposals = [item.new_item for item in ingredients.items if item.new_item is not None]
    return Ingredients(servings=ingredients.servings, items=items), proposals


class RecipeController:
    """Recipes, and who may see them (ADR-0009 §2).

    A `kitchen` recipe is visible to its author and to the kitchen it belongs to.
    **Asking for one you may not see is a 404, not a 403**: the other household's
    "bocatas" is not something this API admits exists.
    """

    def __init__(self, recipe_repository: RecipeRepository, router: APIRouter, kitchen_repository: KitchenRepository, grocery_repository: GroceryRepository) -> None:
        self.recipe_repository = recipe_repository
        self.kitchen_repository = kitchen_repository
        self.grocery_repository = grocery_repository
        self.router = router
        self._register_routes()

    def _viewer(self, user: TokenPayload) -> Viewer:
        kitchen = self.kitchen_repository.active_kitchen_for(user.sub)
        return Viewer(user_id=user.sub, kitchen_id=kitchen.id if kitchen else None)

    def _visible(self, recipe_id: str, viewer: Viewer) -> Recipe:
        recipe = GetRecipe(self.recipe_repository).execute(recipe_id)
        if recipe is None or not recipe.visible_to(viewer):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Recipe with id {recipe_id} not found")
        return recipe

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
            description="Returns every recipe the caller may see: public ones, theirs, and their kitchen's. `mine=true` narrows to the caller",
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
        return use_case.execute(created_by=current_user.sub if mine else None, viewer=self._viewer(current_user))

    def create_recipe(self, request: CreateRecipeRequest, current_user: TokenPayload = Depends(get_current_user)) -> Recipe:
        """Create a new recipe. `created_by` comes from the JWT, and a kitchen recipe joins the caller's kitchen."""
        viewer = self._viewer(current_user)
        ingredients, proposals = _split(request.ingredients)
        recipe_data = request.model_dump(exclude={"created_by", "ingredients"})
        # HttpUrl validates the input but the domain entity stores a plain str.
        recipe_data["source_url"] = str(request.source_url) if request.source_url else None
        kitchen_id = viewer.kitchen_id if request.visibility == Visibility.KITCHEN else None
        recipe = Recipe(**recipe_data, ingredients=ingredients, kitchen_id=kitchen_id, created_by=current_user.sub)
        RememberGroceries(self.grocery_repository).execute(proposals)
        return CreateRecipe(self.recipe_repository).execute(recipe)

    def get_recipe(self, recipe_id: str, current_user: TokenPayload = Depends(get_current_user)) -> Recipe:
        """Get a single recipe by ID, if the caller may see it."""
        return self._visible(recipe_id, self._viewer(current_user))

    def update_recipe(self, recipe_id: str, request: UpdateRecipeRequest, current_user: TokenPayload = Depends(get_current_user)) -> Recipe:
        """Update a recipe: its author, or anybody in the kitchen a kitchen recipe belongs to."""
        viewer = self._viewer(current_user)
        existing_recipe = self._visible(recipe_id, viewer)
        if not existing_recipe.editable_by(viewer):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the recipe's creator can update it")

        # Staying a kitchen recipe keeps its kitchen — a member editing it must
        # not move it — and becoming one joins the editor's.
        if request.visibility == Visibility.KITCHEN:
            kitchen_id = existing_recipe.kitchen_id if existing_recipe.visibility == Visibility.KITCHEN else viewer.kitchen_id
        else:
            kitchen_id = None

        ingredients, proposals = _split(request.ingredients)
        updated_recipe = Recipe(
            id=recipe_id,
            title=request.title,
            instructions=request.instructions,
            ingredients=ingredients,
            food_type=request.food_type,
            # HttpUrl validates the input but the domain entity stores a plain str.
            source_url=str(request.source_url) if request.source_url else None,
            prep_time_minutes=request.prep_time_minutes,
            cook_time_minutes=request.cook_time_minutes,
            tags=request.tags,
            visibility=request.visibility,
            kitchen_id=kitchen_id,
            created_by=existing_recipe.created_by,
            created_at=existing_recipe.created_at,
        )

        RememberGroceries(self.grocery_repository).execute(proposals)
        return UpdateRecipe(self.recipe_repository).execute(updated_recipe)

    def delete_recipe(self, recipe_id: str, current_user: TokenPayload = Depends(get_current_user)) -> None:
        """Delete a recipe: the same people who may edit it."""
        viewer = self._viewer(current_user)
        existing_recipe = self._visible(recipe_id, viewer)
        if not existing_recipe.editable_by(viewer):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the recipe's creator can delete it")

        use_case = DeleteRecipe(self.recipe_repository)
        try:
            use_case.execute(recipe_id)
        except KeyError as e:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
