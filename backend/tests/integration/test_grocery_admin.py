"""The admin side of the grocery vocabulary: rewriting and deleting rows.

Three things worth being wrong about loudly:

1. **Who may.** Membership of the Cognito `admins` group, read off the signed
   token — anybody else gets a 403, whatever the client shows them.
2. **What an edit may not do.** Give a name to two rows (it breaks `name_index`,
   and with it every shopping-list write), or delete a seeded row (the next
   deploy puts it back).
3. **What a delete leaves behind.** A list line still holding the key has to
   read as unfiled again, and be fileable.
"""

from datetime import date

import pytest
from fastapi import APIRouter, FastAPI
from starlette.testclient import TestClient

from src.domain.entities import Aisle, FoodType, GroceryItem, GrocerySource, Ingredient, IngredientParserError, Ingredients, ParsedIngredients, Recipe
from src.domain.ports import IngredientParser
from src.infra.adapters.repos.in_memory_grocery_repo import InMemoryGroceryRepository
from src.infra.adapters.repos.in_memory_kitchen_repo import InMemoryKitchenRepository
from src.infra.adapters.repos.in_memory_meal_plan_repo import InMemoryMealPlanRepository
from src.infra.adapters.repos.in_memory_recipe_repo import InMemoryRecipeRepository
from src.infra.adapters.repos.in_memory_review_repo import InMemoryReviewRepository
from src.infra.adapters.repos.in_memory_user_repo import InMemoryUserRepository
from src.infra.controllers import GroceryController, MealPlanController, UserController
from src.infra.security import ADMIN_GROUP, TokenPayload, get_current_user

ME = "user-nel"
SATURDAY = date(2026, 9, 5)


class _NoParser(IngredientParser):
    def parse(self, text: str, vocabulary: list[GroceryItem], servings: int) -> ParsedIngredients:  # noqa: ARG002 — the port's signature
        raise IngredientParserError("no provider configured")


def _vocabulary() -> list[GroceryItem]:
    return [
        GroceryItem(key="huevos", name_es="Huevos", name_ca="Ous", name_en="Eggs", aisle=Aisle.DAIRY_EGGS, source=GrocerySource.SEED),
        GroceryItem(key="kombucha", name_es="Kombucha", name_ca="Kombutxa", name_en="Kombucha", aisle=Aisle.DRINKS, source=GrocerySource.AI),
        GroceryItem(key="qwerty", name_es="Qwerty", name_ca="Qwerty", name_en="Qwerty", aisle=Aisle.OTHER, source=GrocerySource.HUMAN),
    ]


@pytest.fixture
def groceries() -> InMemoryGroceryRepository:
    return InMemoryGroceryRepository(_vocabulary())


def _client(
    groceries: InMemoryGroceryRepository,
    *,
    admin: bool,
    plans: InMemoryMealPlanRepository | None = None,
    recipes: InMemoryRecipeRepository | None = None,
) -> TestClient:
    users = InMemoryUserRepository()
    users.add(ME, "nel@example.com", "Nel")
    router = APIRouter()
    GroceryController(groceries, recipes or InMemoryRecipeRepository(), _NoParser(), router)
    UserController(users, InMemoryReviewRepository(), router)
    MealPlanController(plans or InMemoryMealPlanRepository(), InMemoryKitchenRepository(), groceries, _NoParser(), router)
    app = FastAPI()
    app.include_router(router)
    claims: dict[str, object] = {"sub": ME, "email": "nel@example.com", "exp": 9999999999}
    if admin:
        claims["cognito:groups"] = [ADMIN_GROUP]
    app.dependency_overrides[get_current_user] = lambda: TokenPayload(**claims)
    return TestClient(app)


def _edit(**overrides: object) -> dict:
    return {"name_es": "Kombucha", "name_ca": "Kombutxa", "name_en": "Kombucha", "aisle": "drinks", "is_pantry": False, "default_unit": None, **overrides}


class TestWhoMay:
    def test_somebody_outside_the_group_is_refused_every_admin_route(self, groceries: InMemoryGroceryRepository) -> None:
        client = _client(groceries, admin=False)

        assert client.put("/admin/grocery-items/kombucha", json=_edit()).status_code == 403
        assert client.delete("/admin/grocery-items/kombucha").status_code == 403
        assert client.get("/admin/grocery-items/usage").status_code == 403
        assert groceries.get("kombucha") is not None

    def test_me_says_whether_you_are_one(self, groceries: InMemoryGroceryRepository) -> None:
        """The client shows the Admin tab from this. It is read off the same
        token the routes check, so the two cannot disagree."""
        assert _client(groceries, admin=True).get("/users/me").json()["is_admin"] is True
        assert _client(groceries, admin=False).get("/users/me").json()["is_admin"] is False

    def test_renaming_yourself_keeps_the_flag(self, groceries: InMemoryGroceryRepository) -> None:
        """The client replaces its cached profile with the PATCH response; one
        without the flag would hide the tab until the next reload."""
        response = _client(groceries, admin=True).patch("/users/me", json={"display_name": "Manel"})

        assert response.json()["is_admin"] is True


class TestEditing:
    def test_a_row_is_rewritten_confirmed_and_keeps_its_key(self, groceries: InMemoryGroceryRepository) -> None:
        response = _client(groceries, admin=True).put(
            "/admin/grocery-items/kombucha", json=_edit(name_es="  Kombucha de jengibre ", aisle="canned", default_unit=" ml ", is_pantry=True)
        )

        assert response.status_code == 200, response.text
        row = groceries.get("kombucha")
        assert row is not None
        assert (row.name_es, row.aisle, row.default_unit, row.is_pantry) == ("Kombucha de jengibre", Aisle.CANNED, "ml", True)
        assert row.confirmed_at is not None
        assert row.source == GrocerySource.AI, "who created a row does not change because somebody edited it"

    def test_a_name_another_row_owns_is_refused_and_says_which(self, groceries: InMemoryGroceryRepository) -> None:
        """The typo row renamed to the real word. That is a duplicate, and the
        fix is to delete it — which the message makes obvious."""
        response = _client(groceries, admin=True).put("/admin/grocery-items/qwerty", json=_edit(name_es="Qwerty", name_ca="Ous", name_en="Qwerty"))

        assert response.status_code == 409
        assert "huevos" in response.json()["detail"]
        assert groceries.get("qwerty").name_ca == "Qwerty"  # type: ignore[union-attr]

    def test_a_blank_name_is_refused(self, groceries: InMemoryGroceryRepository) -> None:
        assert _client(groceries, admin=True).put("/admin/grocery-items/kombucha", json=_edit(name_en="   ")).status_code == 422

    def test_an_unknown_row_is_a_404(self, groceries: InMemoryGroceryRepository) -> None:
        assert _client(groceries, admin=True).put("/admin/grocery-items/nope", json=_edit()).status_code == 404

    def test_the_seed_leaves_an_edited_row_exactly_as_the_admin_left_it(self, groceries: InMemoryGroceryRepository) -> None:
        """The seed runs on every deploy. An admin's rename that lasted until the
        next push would look like it worked and then quietly undo itself."""
        _client(groceries, admin=True).put(
            "/admin/grocery-items/huevos", json={"name_es": "Huevos camperos", "name_ca": "Ous", "name_en": "Eggs", "aisle": "dairy_eggs", "is_pantry": False}
        )

        groceries.upsert_many([GroceryItem(key="huevos", name_es="Huevos", name_ca="Ous", name_en="Eggs", aisle=Aisle.PRODUCE, source=GrocerySource.SEED)])

        row = groceries.get("huevos")
        assert (row.name_es, row.aisle) == ("Huevos camperos", Aisle.DAIRY_EGGS)  # type: ignore[union-attr]


class TestDeleting:
    def test_junk_goes(self, groceries: InMemoryGroceryRepository) -> None:
        response = _client(groceries, admin=True).delete("/admin/grocery-items/qwerty")

        assert response.status_code == 204
        assert groceries.get("qwerty") is None

    def test_a_seeded_row_is_refused_because_the_next_deploy_would_bring_it_back(self, groceries: InMemoryGroceryRepository) -> None:
        response = _client(groceries, admin=True).delete("/admin/grocery-items/huevos")

        assert response.status_code == 409
        assert "grocery_seed_data.py" in response.json()["detail"]
        assert groceries.get("huevos") is not None

    def test_an_unknown_row_is_a_404(self, groceries: InMemoryGroceryRepository) -> None:
        assert _client(groceries, admin=True).delete("/admin/grocery-items/nope").status_code == 404

    def test_a_line_left_holding_the_deleted_key_can_be_filed_again(self, groceries: InMemoryGroceryRepository) -> None:
        """No foreign key, so the line keeps the key as text. It must behave as
        unfiled — otherwise the list shows it in Other and then refuses to move it."""
        plans = InMemoryMealPlanRepository()
        client = _client(groceries, admin=True, plans=plans)
        plan = client.post("/plans/items", json={"day": SATURDAY.isoformat(), "items": [{"name": "Kombucha"}]}).json()
        line = plan["items"][0]
        assert line["grocery_key"] == "kombucha"
        client.delete("/admin/grocery-items/kombucha")

        after = client.put(f"/plans/{plan['id']}/items/{line['id']}/aisle", json={"aisle": "drinks"})

        assert after.status_code == 200, after.text
        row = groceries.get("kombucha")
        assert row is not None
        assert (row.aisle, row.source) == (Aisle.DRINKS, GrocerySource.HUMAN)


def _recipe(title: str, *names: str) -> Recipe:
    return Recipe(
        title=title,
        ingredients=Ingredients(servings=2, items=[Ingredient(name=name) for name in names]),
        food_type=FoodType.COMIDA,
        created_by=ME,
    )


class TestUsage:
    """Which recipes use a row. Recipes hold names, not keys, so this is the
    same name resolution the shopping list does — and has to agree with it."""

    def test_each_row_lists_the_recipes_that_use_it_alphabetically(self, groceries: InMemoryGroceryRepository) -> None:
        recipes = InMemoryRecipeRepository()
        tortilla = recipes.add_recipe(_recipe("Tortilla", "huevos", "patata"))
        flan = recipes.add_recipe(_recipe("Flan", "Ous", "azúcar"))

        usage = _client(groceries, admin=True, recipes=recipes).get("/admin/grocery-items/usage").json()

        assert usage["huevos"] == [{"id": flan.id, "title": "Flan"}, {"id": tortilla.id, "title": "Tortilla"}], "any of the three names counts"
        assert "kombucha" not in usage, "a row nobody uses is absent, not an empty list"
        assert "patata" not in usage, "a name the vocabulary does not know is skipped"

    def test_one_recipe_naming_a_row_twice_is_one_use(self, groceries: InMemoryGroceryRepository) -> None:
        recipes = InMemoryRecipeRepository()
        recipes.add_recipe(_recipe("Revuelto", "huevos", "Huevos"))

        usage = _client(groceries, admin=True, recipes=recipes).get("/admin/grocery-items/usage").json()

        assert len(usage["huevos"]) == 1
