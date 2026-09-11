from datetime import UTC, datetime

from src.domain.entities import Recipe
from src.domain.ports import RecipeRepository


class InMemoryRecipeRepository(RecipeRepository):
    """In-memory repository for unit tests only.

    Not used in production. Allows use-case tests to run without
    any database or Docker dependency.
    """

    def __init__(self) -> None:
        self.table: dict[str, dict] = {}

    def add_recipe(self, recipe: Recipe) -> Recipe:
        self.table[recipe.id] = recipe.model_dump()
        return Recipe(**self.table[recipe.id])  # New instance each time. Prevents accidental mutations of the in-memory dict.

    def get_recipe(self, recipe_id: str) -> Recipe | None:
        recipe_data = self.table.get(recipe_id)
        if recipe_data is None:
            return None
        return Recipe(**recipe_data)

    def list_recipes(self, created_by: str | None = None) -> list[Recipe]:
        recipes = []
        for recipe_data in self.table.values():
            recipe = Recipe(**recipe_data)
            if created_by is not None and recipe.created_by != created_by:
                continue
            recipes.append(recipe)
        return recipes

    def update_recipe(self, recipe: Recipe) -> Recipe:
        if recipe.id not in self.table:
            raise KeyError(f"Recipe with id {recipe.id} not found")

        recipe_data = recipe.model_dump()
        # Update timestamp in UTC (AWS best practice)
        recipe_data["updated_at"] = datetime.now(UTC).isoformat()
        self.table[recipe.id] = recipe_data

        return Recipe(**self.table[recipe.id])

    def delete_recipe(self, recipe_id: str) -> None:
        if recipe_id not in self.table:
            raise KeyError(f"Recipe with id {recipe_id} not found")

        del self.table[recipe_id]
