from src.domain.entities import Recipe, Viewer
from src.domain.ports import RecipeRepository


class ListRecipes:
    def __init__(self, recipe_repository: RecipeRepository) -> None:
        self.recipe_repository = recipe_repository

    def execute(self, created_by: str | None = None, viewer: Viewer | None = None) -> list[Recipe]:
        """Every recipe `viewer` may see, or only one author's when `created_by` is given."""
        return self.recipe_repository.list_recipes(created_by=created_by, viewer=viewer)
