from fastapi import APIRouter, Depends, HTTPException

from src.app.use_cases import ListGroceryItems, ParseIngredients
from src.domain.entities import GroceryItem, IngredientParserError
from src.domain.entities.parsed_ingredient import ResolvedIngredients
from src.domain.ports import GroceryRepository, IngredientParser
from src.infra.controllers.schemas.grocery import ParseIngredientsRequest
from src.infra.security import get_current_user


class GroceryController:
    """The shared grocery vocabulary (docs/plans/ingredient-capture-plan.md §3).

    Its own controller rather than a route bolted onto the meal planner, because
    the vocabulary has two consumers that live on opposite sides of the app: the
    shopping list groups by its aisles, and `cook` will match free-typed
    ingredients against it. Hanging it off either one would make the other's
    dependency look accidental.

    Two routes: the vocabulary itself, and the parser that writes into it.
    """

    def __init__(self, grocery_repository: GroceryRepository, parser: IngredientParser, router: APIRouter) -> None:
        self.router = router
        self.grocery_repository = grocery_repository
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

    def list_items(self) -> list[GroceryItem]:
        return ListGroceryItems(self.grocery_repository).execute()

    def parse_ingredients(self, request: ParseIngredientsRequest) -> ResolvedIngredients:
        try:
            return ParseIngredients(self.parser, self.grocery_repository).execute(request.text, request.servings)
        except IngredientParserError as error:
            # 503, not 500: nothing here is broken, an external service is
            # unreachable — and the client's answer is to fall back to raw lines
            # the user edits by hand, which is a different thing from retrying.
            raise HTTPException(status_code=503, detail=str(error)) from error
