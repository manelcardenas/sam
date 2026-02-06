from abc import ABC, abstractmethod

from src.domain.entities import Recipe


class RecipeRepository(ABC):
    @abstractmethod
    def add_recipe(self, recipe: Recipe) -> Recipe:
        pass

    @abstractmethod
    def get_recipe(self, recipe_id: str) -> Recipe | None:
        pass

    @abstractmethod
    def list_recipes(self) -> list[Recipe]:
        pass

    @abstractmethod
    def delete_recipe(self, recipe_id: str) -> None:
        pass

    @abstractmethod
    def update_recipe(self, recipe: Recipe) -> Recipe:
        pass
