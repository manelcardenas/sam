from src.domain.entities import Recipe
from src.domain.ports import RecipeRepository


class GetRecipe:
    def __init__(self, recipe_repository: RecipeRepository) -> None:
        self.recipe_repository = recipe_repository

    def execute(self, recipe_id: str) -> Recipe | None:
        return self.recipe_repository.get_recipe(recipe_id)
