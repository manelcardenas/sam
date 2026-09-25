from fastapi import APIRouter, Depends, HTTPException, Response, status

from src.app.use_cases import DeleteGroceryItem, ListGroceryItems, ListGroceryUsage, ParseIngredients, SetGroceryAisle, UpdateGroceryItem
from src.domain.entities import GroceryItem, IngredientParserError, RecipeRef
from src.domain.entities.parsed_ingredient import ResolvedIngredients
from src.domain.errors import GroceryNameTakenError, SeedGroceryItemError
from src.domain.ports import GroceryRepository, IngredientParser, RecipeRepository
from src.infra.controllers.schemas.grocery import ParseIngredientsRequest, SetAisleRequest, UpdateGroceryItemRequest
from src.infra.security import get_current_user, require_admin


class GroceryController:
    """The shared grocery vocabulary (docs/plans/ingredient-capture-plan.md §3).

    Its own controller rather than a route bolted onto the meal planner, because
    the vocabulary has two consumers that live on opposite sides of the app: the
    shopping list groups by its aisles, and `cook` will match free-typed
    ingredients against it. Hanging it off either one would make the other's
    dependency look accidental.

    Three routes anybody signed in can use — the vocabulary itself, the parser
    that writes into it, and the aisle correction — and three under `/admin` for
    the Cognito `admins` group: which recipes use each row, rewriting a row and
    deleting one. The prefix is
    there so the privilege is visible in the route table, not only in a
    dependency.
    """

    def __init__(self, grocery_repository: GroceryRepository, recipe_repository: RecipeRepository, parser: IngredientParser, router: APIRouter) -> None:
        self.router = router
        self.grocery_repository = grocery_repository
        self.recipe_repository = recipe_repository
        self.parser = parser

        self.router.add_api_route(
            "/grocery-items",
            self.list_items,
            methods=["GET"],
            response_model=list[GroceryItem],
            dependencies=[Depends(get_current_user)],
            summary="List grocery items",
            description="Returns the whole grocery vocabulary — names in three languages, aisle, and whether it is a pantry staple",
            tags=["Groceries"],
        )

        self.router.add_api_route(
            "/ingredients/parse",
            self.parse_ingredients,
            methods=["POST"],
            response_model=ResolvedIngredients,
            dependencies=[Depends(get_current_user)],
            summary="Structure free-typed ingredients",
            description="Turns a block of free text into reviewable ingredient lines, matched against the grocery vocabulary",
            tags=["Groceries"],
        )

        self.router.add_api_route(
            "/grocery-items/{key}/aisle",
            self.set_aisle,
            methods=["PUT"],
            response_model=GroceryItem,
            dependencies=[Depends(get_current_user)],
            summary="Move a grocery item to another aisle",
            description="Corrects the shared vocabulary for everybody and marks the row confirmed, so re-running the seed will not move it back",
            tags=["Groceries"],
        )

        admin = {"dependencies": [Depends(require_admin)], "tags": ["Admin"]}
        # Before the `{key}` routes only for reading order; they take PUT and
        # DELETE, so a GET here can never be mistaken for a row called "usage".
        self.router.add_api_route(
            "/admin/grocery-items/usage",
            self.list_usage,
            methods=["GET"],
            response_model=dict[str, list[RecipeRef]],
            summary="Which recipes use each grocery item",
            description="Every recipe's ingredient names resolved against the vocabulary, as the shopping list resolves them. Keys no recipe uses are absent.",
            **admin,
        )
        self.router.add_api_route(
            "/admin/grocery-items/{key}",
            self.update_item,
            methods=["PUT"],
            response_model=GroceryItem,
            summary="Rewrite a grocery item",
            description="Names, aisle, pantry flag and unit. The key never changes. Marks the row confirmed, so the seed leaves it alone from now on. 409 if a name is another row's.",
            **admin,
        )
        self.router.add_api_route(
            "/admin/grocery-items/{key}",
            self.delete_item,
            methods=["DELETE"],
            status_code=status.HTTP_204_NO_CONTENT,
            summary="Delete a grocery item",
            description="For junk the parser or a person created. 409 for seeded rows, which the next deploy would recreate.",
            **admin,
        )

    def list_items(self) -> list[GroceryItem]:
        return ListGroceryItems(self.grocery_repository).execute()

    def list_usage(self) -> dict[str, list[RecipeRef]]:
        return ListGroceryUsage(self.recipe_repository, self.grocery_repository).execute()

    def parse_ingredients(self, request: ParseIngredientsRequest) -> ResolvedIngredients:
        try:
            return ParseIngredients(self.parser, self.grocery_repository).execute(request.text, request.servings)
        except IngredientParserError as error:
            # 503, not 500: nothing here is broken, an external service is
            # unreachable — and the client's answer is to fall back to raw lines
            # the user edits by hand, which is a different thing from retrying.
            raise HTTPException(status_code=503, detail=str(error)) from error

    def set_aisle(self, key: str, request: SetAisleRequest) -> GroceryItem:
        try:
            return SetGroceryAisle(self.grocery_repository).execute(key, request.aisle)
        except KeyError as error:
            raise HTTPException(status_code=404, detail=str(error).strip("'")) from error

    def update_item(self, key: str, request: UpdateGroceryItemRequest) -> GroceryItem:
        try:
            return UpdateGroceryItem(self.grocery_repository).execute(key, **request.model_dump())
        except KeyError as error:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error).strip("'")) from error
        except GroceryNameTakenError as error:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error

    def delete_item(self, key: str) -> Response:
        try:
            DeleteGroceryItem(self.grocery_repository).execute(key)
        except KeyError as error:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error).strip("'")) from error
        except SeedGroceryItemError as error:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
        return Response(status_code=status.HTTP_204_NO_CONTENT)
