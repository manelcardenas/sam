from backend.src.domain.entities import Recipe
from backend.src.domain.ports import RecipeRepository


class ListRecipes:
    def __init__(self, recipe_repository: RecipeRepository) -> None:
        self.recipe_repository = recipe_repository

    def execute(self) -> list[Recipe]:
        return self.recipe_repository.list_recipes()
