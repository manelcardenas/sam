from src.domain.entities import Recipe
from src.domain.ports import RecipeRepository


class ListRecipes:
    def __init__(self, recipe_repository: RecipeRepository) -> None:
        self.recipe_repository = recipe_repository

    def execute(self) -> list[Recipe]:
        return self.recipe_repository.list_recipes()
