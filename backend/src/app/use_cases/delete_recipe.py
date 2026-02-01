from src.domain.ports import RecipeRepository


class DeleteRecipe:
    def __init__(self, recipe_repository: RecipeRepository) -> None:
        self.recipe_repository = recipe_repository

    def execute(self, recipe_id: str) -> None:
        self.recipe_repository.delete_recipe(recipe_id)
