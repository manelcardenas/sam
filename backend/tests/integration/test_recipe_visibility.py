"""Kitchen recipes, tags, optional ingredients and saving new vocabulary (ADR-0009 §2, §7, §8).

A simple recipe ("ensalada con carne") belongs to the household that eats it:
its two members see and edit it, everybody else gets a 404 as if it did not
exist. And a product the model proposed while reading a recipe only joins the
shared vocabulary when the recipe is saved.
"""

from fastapi import APIRouter, FastAPI
from starlette.testclient import TestClient

from src.domain.entities import Aisle, GroceryItem, GrocerySource
from src.infra.adapters.repos.in_memory_grocery_repo import InMemoryGroceryRepository
from src.infra.adapters.repos.in_memory_kitchen_repo import InMemoryKitchenRepository
from src.infra.adapters.repos.in_memory_recipe_repo import InMemoryRecipeRepository
from src.infra.controllers import RecipeController
from src.infra.security import TokenPayload, get_current_user

NEL, MARTINA, STRANGER = "user-nel", "user-martina", "user-stranger"

SALAD = {
    "title": "Ensalada con carne",
    "food_type": "comida",
    "visibility": "kitchen",
    "tags": ["tupper", "no_cook"],
    "ingredients": {
        "servings": 1,
        "items": [
            {"name": "carne", "amount": 150, "unit": "g"},
            {"name": "maíz", "amount": 30, "unit": "g", "optional": True},
        ],
    },
}


class World:
    """One shared kitchen (nel + martina) and somebody outside it."""

    def __init__(self) -> None:
        self.recipes = InMemoryRecipeRepository()
        self.kitchens = InMemoryKitchenRepository()
        self.groceries = InMemoryGroceryRepository(
            [GroceryItem(key="carne", name_es="carne", name_ca="carn", name_en="meat", aisle=Aisle.MEAT_FISH, default_unit="g", source=GrocerySource.SEED)]
        )
        kitchen = self.kitchens.create_kitchen(NEL)
        self.kitchens.create_kitchen(MARTINA)
        self.kitchens.invite(kitchen.id, MARTINA, invited_by=NEL)
        self.kitchens.accept_invitation(kitchen.id, MARTINA)
        self.kitchens.create_kitchen(STRANGER)

    def client(self, caller: str) -> TestClient:
        router = APIRouter()
        RecipeController(self.recipes, router, self.kitchens, self.groceries)
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_current_user] = lambda: TokenPayload(sub=caller, email=f"{caller}@example.com", exp=9999999999)
        return TestClient(app)


def test_a_kitchen_recipe_is_seen_by_its_kitchen_and_nobody_else() -> None:
    world = World()
    created = world.client(NEL).post("/recipes", json=SALAD).json()

    assert created["visibility"] == "kitchen"
    assert created["kitchen_id"] is not None
    assert [r["title"] for r in world.client(MARTINA).get("/recipes").json()] == ["Ensalada con carne"]
    assert world.client(STRANGER).get("/recipes").json() == []
    assert world.client(STRANGER).get(f"/recipes/{created['id']}").status_code == 404


def test_a_kitchen_member_may_edit_it_but_a_stranger_cannot_even_find_it() -> None:
    world = World()
    created = world.client(NEL).post("/recipes", json=SALAD).json()
    more_meat = {**SALAD, "ingredients": {"servings": 1, "items": [{"name": "carne", "amount": 200, "unit": "g"}]}}

    edited = world.client(MARTINA).put(f"/recipes/{created['id']}", json=more_meat)

    assert edited.status_code == 200
    assert edited.json()["ingredients"]["items"][0]["amount"] == 200
    assert edited.json()["kitchen_id"] == created["kitchen_id"], "a member editing must not move it to another kitchen"
    assert edited.json()["created_by"] == NEL
    assert world.client(STRANGER).put(f"/recipes/{created['id']}", json=more_meat).status_code == 404


def test_public_recipes_stay_their_authors() -> None:
    world = World()
    created = world.client(NEL).post("/recipes", json={**SALAD, "visibility": "public", "instructions": "Mezclar."}).json()

    assert created["kitchen_id"] is None
    assert world.client(STRANGER).get(f"/recipes/{created['id']}").status_code == 200
    assert world.client(MARTINA).put(f"/recipes/{created['id']}", json=SALAD).status_code == 403


def test_tags_and_optional_ingredients_round_trip() -> None:
    world = World()
    created = world.client(NEL).post("/recipes", json=SALAD).json()

    assert created["tags"] == ["tupper", "no_cook"]
    assert [item["optional"] for item in created["ingredients"]["items"]] == [False, True]


def test_an_unknown_tag_is_refused() -> None:
    response = World().client(NEL).post("/recipes", json={**SALAD, "tags": ["vegetarian"]})

    assert response.status_code == 422


def test_saving_a_recipe_adds_its_new_products_to_the_vocabulary() -> None:
    world = World()
    kombucha = {"name_es": "kombucha", "name_ca": "kombutxa", "name_en": "kombucha", "aisle": "drinks", "is_pantry": False, "default_unit": "ml"}
    body = {**SALAD, "ingredients": {"servings": 1, "items": [{"name": "kombucha", "amount": 330, "unit": "ml", "new_item": kombucha}]}}

    created = world.client(NEL).post("/recipes", json=body).json()

    row = world.groceries.get("kombucha")
    assert row is not None
    assert row.source == GrocerySource.AI
    assert row.confirmed_at is None
    assert row.default_unit == "ml"
    assert "new_item" not in created["ingredients"]["items"][0], "the proposal is not stored on the recipe"


def test_a_proposal_that_already_exists_under_another_name_is_not_written_again() -> None:
    world = World()
    meat_in_catalan = {"name_es": "carn", "name_ca": "carn", "name_en": "meat", "aisle": "meat_fish", "is_pantry": False, "default_unit": "g"}
    body = {**SALAD, "ingredients": {"servings": 1, "items": [{"name": "carn", "amount": 150, "unit": "g", "new_item": meat_in_catalan}]}}

    assert world.client(NEL).post("/recipes", json=body).status_code == 201
    assert [item.key for item in world.groceries.list_all()] == ["carne"]
