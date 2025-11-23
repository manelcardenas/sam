from src.domain.entities import Recipe
from src.domain.ports import RecipeRepository


class UpdateRecipes:
    def __init__(self, recipe_repository: RecipeRepository) -> None:
        self.recipe_repository = recipe_repository

    def execute(self, recipe: Recipe) -> Recipe:
        return self.recipe_repository.update_recipe(recipe)
