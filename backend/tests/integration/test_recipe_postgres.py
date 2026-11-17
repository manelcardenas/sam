"""Recipe visibility, tags and optional ingredients against a real Postgres. Opt-in.

`list_recipes(viewer=...)` is `Recipe.visible_to` rewritten as SQL, and the two
must agree; the in-memory repo runs the Python rule, so only this suite can
catch the SQL one drifting.
"""

import os
import uuid

import pytest
from dotenv import load_dotenv
from sqlalchemy import text

from src.domain.entities import Ingredient, Ingredients, Recipe, RecipeTag, Viewer, Visibility
from src.infra.adapters.repos.postgres_kitchen_repo import PostgresKitchenRepository
from src.infra.adapters.repos.postgres_recipe_repo import PostgresRecipeRepository
from src.infra.db import DatabaseConnectionPool, build_dsn

pytestmark = pytest.mark.skipif(
    os.getenv("SAM_TEST_POSTGRES") != "1",
    reason="Set SAM_TEST_POSTGRES=1 to run against a real database",
)


@pytest.fixture(scope="module")
def pool() -> DatabaseConnectionPool:
    load_dotenv()
    db = DatabaseConnectionPool(dsn=build_dsn())
    db.open()
    yield db
    db.close()


@pytest.fixture
def people(pool: DatabaseConnectionPool) -> list[str]:
    """Three throwaway users; everything they wrote and every kitchen they made goes with them."""
    ids = [f"test-recipe-{label}-{uuid.uuid4()}" for label in ("cook", "mate", "stranger")]
    with pool.session_factory() as session:
        for user_id in ids:
            session.execute(text("INSERT INTO users (id, email) VALUES (:id, :email)"), {"id": user_id, "email": f"{user_id}@example.test"})
        session.commit()
    yield ids
    with pool.session_factory() as session:
        for user_id in ids:
            session.execute(text("DELETE FROM recipes WHERE created_by = :id"), {"id": user_id})
            session.execute(text("DELETE FROM kitchens WHERE id IN (SELECT kitchen_id FROM kitchen_members WHERE user_id = :id)"), {"id": user_id})
            session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        session.commit()


def _recipe(author: str, title: str, visibility: Visibility, kitchen_id: str | None = None) -> Recipe:
    return Recipe(
        title=title,
        ingredients=Ingredients(servings=1, items=[Ingredient(name="carne", amount=150, unit="g"), Ingredient(name="maíz", optional=True)]),
        food_type="comida",
        tags=[RecipeTag.TUPPER, RecipeTag.NO_COOK],
        visibility=visibility,
        kitchen_id=kitchen_id,
        created_by=author,
    )


def test_a_viewer_sees_public_recipes_their_own_and_their_kitchens(pool: DatabaseConnectionPool, people: list[str]) -> None:
    cook, mate, stranger = people
    kitchens = PostgresKitchenRepository(session_factory=pool.session_factory)
    recipes = PostgresRecipeRepository(session_factory=pool.session_factory)
    kitchen = kitchens.create_kitchen(cook)
    kitchens.create_kitchen(mate)
    kitchens.invite(kitchen.id, mate, invited_by=cook)
    kitchens.accept_invitation(kitchen.id, mate)

    recipes.add_recipe(_recipe(cook, "Ensalada con carne", Visibility.KITCHEN, kitchen.id))
    recipes.add_recipe(_recipe(stranger, "Bocatas del vecino", Visibility.KITCHEN))
    recipes.add_recipe(_recipe(stranger, "Lentejas", Visibility.PUBLIC))

    def titles(viewer: Viewer) -> set[str]:
        return {r.title for r in recipes.list_recipes(viewer=viewer) if r.created_by in people}

    assert titles(Viewer(user_id=mate, kitchen_id=kitchen.id)) == {"Ensalada con carne", "Lentejas"}
    assert titles(Viewer(user_id=stranger)) == {"Bocatas del vecino", "Lentejas"}
    assert titles(Viewer(user_id=cook, kitchen_id=None)) == {"Ensalada con carne", "Lentejas"}, "the author keeps seeing it after leaving"


def test_tags_visibility_and_optional_round_trip(pool: DatabaseConnectionPool, people: list[str]) -> None:
    cook = people[0]
    kitchen = PostgresKitchenRepository(session_factory=pool.session_factory).create_kitchen(cook)
    recipes = PostgresRecipeRepository(session_factory=pool.session_factory)

    saved = recipes.add_recipe(_recipe(cook, "Ensalada con carne", Visibility.KITCHEN, kitchen.id))
    read = recipes.get_recipe(saved.id)

    assert read is not None
    assert read.tags == [RecipeTag.TUPPER, RecipeTag.NO_COOK]
    assert (read.visibility, read.kitchen_id) == (Visibility.KITCHEN, kitchen.id)
    assert [item.optional for item in read.ingredients.items] == [False, True]

    read.tags = [RecipeTag.OVEN]
    read.visibility = Visibility.PUBLIC
    read.kitchen_id = None
    updated = recipes.update_recipe(read)
    assert (updated.tags, updated.visibility, updated.kitchen_id) == ([RecipeTag.OVEN], Visibility.PUBLIC, None)
