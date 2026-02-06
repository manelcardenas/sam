import os

import httpx
from src.domain.entities import Recipe


class RecipeAPIClient:
    """HTTP client for Recipe API."""

    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = base_url or os.getenv("API_URL", "http://localhost:9000")
        self.client = httpx.Client(base_url=self.base_url, timeout=30.0)

    def health(self) -> dict:
        """Check API health."""
        response = self.client.get("/health")
        response.raise_for_status()
        return response.json()

    def list_recipes(self) -> list[Recipe]:
        """Get all recipes."""
        response = self.client.get("/recipes")
        response.raise_for_status()
        return [Recipe(**item) for item in response.json()]

    def create_recipe(self, title: str, description: str, ingredients: list[str]) -> Recipe:
        """Create a new recipe."""
        response = self.client.post(
            "/recipes",
            json={
                "title": title,
                "description": description,
                "ingredients": ingredients,
            },
        )
        response.raise_for_status()
        return Recipe(**response.json())

    def get_recipe(self, recipe_id: str) -> Recipe | None:
        """Get a recipe by ID."""
        response = self.client.get(f"/recipes/{recipe_id}")
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return Recipe(**response.json())

    def update_recipe(self, recipe_id: str, title: str, description: str, ingredients: list[str]) -> Recipe:
        """Update an existing recipe."""
        response = self.client.put(
            f"/recipes/{recipe_id}",
            json={
                "title": title,
                "description": description,
                "ingredients": ingredients,
            },
        )
        response.raise_for_status()
        return Recipe(**response.json())

    def delete_recipe(self, recipe_id: str) -> None:
        """Delete a recipe."""
        response = self.client.delete(f"/recipes/{recipe_id}")
        response.raise_for_status()
