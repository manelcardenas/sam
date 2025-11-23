from datetime import datetime

from src.domain.entities import Recipe
from src.domain.ports import RecipeRepository


class InMemoryRecipeRepository(RecipeRepository):
    def __init__(self) -> None:
        self.table: dict[str, dict] = {}  # String keys like DynamoDB partition keys

    def add_recipe(self, recipe: Recipe) -> Recipe:
        self.table[recipe.id] = recipe.model_dump()
        return Recipe(**self.table[recipe.id])  # New instance each time. DynamoDB returns deserialized data, not references. This prevents accidental mutations.

    def get_recipe(self, recipe_id: str) -> Recipe | None:
        recipe_data = self.table.get(recipe_id)
        if recipe_data is None:
            return None
        return Recipe(**recipe_data)

    def list_recipes(self) -> list[Recipe]:
        recipes = []
        for recipe_data in self.table.values():
            recipes.append(Recipe(**recipe_data))
        return recipes

    def update_recipe(self, recipe: Recipe) -> Recipe:
        if recipe.id not in self.table:
            raise ValueError("Recipe not found")

        recipe.updated_at = datetime.now().isoformat()
        self.table[recipe.id] = recipe.model_dump()

        return Recipe(**self.table[recipe.id])

    def delete_recipe(self, recipe_id: str) -> None:
        if recipe_id not in self.table:
            raise KeyError(f"Recipe with id {recipe_id} not found")

        del self.table[recipe_id]
