import os
from datetime import UTC, datetime

import boto3
from src.domain.entities.recipe import Recipe
from src.domain.ports import RecipeRepository


class DynamoDBRecipeRepository(RecipeRepository):
    def __init__(self) -> None:
        self.table_name = os.getenv("TABLE_NAME")
        if not self.table_name:
            raise ValueError("TABLE_NAME environment variable is not set")
        region = os.getenv("AWS_REGION")
        endpoint_url = os.getenv("DYNAMODB_ENDPOINT")

        if endpoint_url:
            self.dynamodb = boto3.resource("dynamodb", region_name=region, endpoint_url=endpoint_url)
        else:
            self.dynamodb = boto3.resource("dynamodb", region_name=region)
        self.table = self.dynamodb.Table(self.table_name)

    def add_recipe(self, recipe: Recipe) -> Recipe:
        self.table.put_item(Item=recipe.model_dump())
        return recipe

    def get_recipe(self, recipe_id: str) -> Recipe | None:
        response = self.table.get_item(Key={"id": recipe_id})
        item = response.get("Item")
        if not item:
            return None
        return Recipe(**item)

    def list_recipes(self) -> list[Recipe]:
        response = self.table.scan()
        items = response.get("Items", [])
        return [Recipe(**item) for item in items]

    def update_recipe(self, recipe: Recipe) -> Recipe:
        existing = self.get_recipe(recipe.id)
        if existing is None:
            raise KeyError(f"Recipe with id {recipe.id} not found")
        recipe_data = recipe.model_dump()
        recipe_data["updated_at"] = datetime.now(UTC).isoformat()
        self.table.put_item(Item=recipe_data)
        return Recipe(**recipe_data)

    def delete_recipe(self, recipe_id: str) -> None:
        existing = self.get_recipe(recipe_id)
        if existing is None:
            raise KeyError(f"Recipe with id {recipe_id} not found")
        self.table.delete_item(Key={"id": recipe_id})
