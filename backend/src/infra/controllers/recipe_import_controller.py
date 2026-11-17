from fastapi import APIRouter, Depends, HTTPException, status

from src.app.use_cases import ImportRecipe
from src.domain.entities import RecipeDraft, RecipePageError, RecipeReaderError, Viewer
from src.domain.ports import GroceryRepository, KitchenRepository, RecipePageFetcher, RecipeReader, RecipeRepository
from src.infra.controllers.schemas.recipe import ImportRecipeRequest
from src.infra.security import TokenPayload, get_current_user


class RecipeImportController:
    """`POST /recipes/import` — a recipe from text, a link or a photo, as a draft (ADR-0009 §8).

    Its own controller because it is the one recipe route that costs money and
    reaches outside: a model call, and for links a fetch from the open web. It
    writes nothing; the draft is saved through `POST /recipes` like any recipe.
    """

    def __init__(
        self,
        reader: RecipeReader,
        fetcher: RecipePageFetcher,
        grocery_repository: GroceryRepository,
        recipe_repository: RecipeRepository,
        kitchen_repository: KitchenRepository,
        router: APIRouter,
    ) -> None:
        self.use_case = ImportRecipe(reader, fetcher, grocery_repository, recipe_repository)
        self.kitchen_repository = kitchen_repository
        router.add_api_route(
            "/recipes/import",
            self.import_recipe,
            methods=["POST"],
            response_model=RecipeDraft,
            summary="Read a recipe from text, a link or a photo",
            description="Returns a draft to review: every source line as at least one row, products matched to the vocabulary or proposed. Nothing is saved.",
            tags=["Recipes"],
        )

    def import_recipe(self, request: ImportRecipeRequest, current_user: TokenPayload = Depends(get_current_user)) -> RecipeDraft:
        kitchen = self.kitchen_repository.active_kitchen_for(current_user.sub)
        viewer = Viewer(user_id=current_user.sub, kitchen_id=kitchen.id if kitchen else None)
        try:
            if request.url:
                return self.use_case.from_url(request.url, viewer)
            if request.image:
                return self.use_case.from_image(request.image, viewer)
            return self.use_case.from_text(request.text or "", viewer)
        except RecipePageError as error:
            # 422: the link is the problem, and the person can paste the text instead.
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error
        except RecipeReaderError as error:
            # 503, as for the ingredient box: an outside service failed, nothing here is broken.
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error
