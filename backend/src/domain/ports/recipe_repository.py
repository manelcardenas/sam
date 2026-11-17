from abc import ABC, abstractmethod

from src.domain.entities import Recipe, Viewer


class RecipeRepository(ABC):
    @abstractmethod
    def add_recipe(self, recipe: Recipe) -> Recipe:
        pass

    @abstractmethod
    def get_recipe(self, recipe_id: str) -> Recipe | None:
        """Any recipe by id, regardless of who may see it — callers check `Recipe.visible_to`."""

    @abstractmethod
    def list_recipes(self, created_by: str | None = None, viewer: Viewer | None = None) -> list[Recipe]:
        """Recipes, optionally one author's, and optionally only those `viewer` may see.

        `viewer=None` is every recipe in the table — for the admin's usage view
        and for scripts, never for a person's own list.
        """

    @abstractmethod
    def delete_recipe(self, recipe_id: str) -> None:
        pass

    @abstractmethod
    def update_recipe(self, recipe: Recipe) -> Recipe:
        pass
