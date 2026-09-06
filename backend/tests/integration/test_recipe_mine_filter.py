"""`GET /recipes?mine=true` (routing-and-latency-plan.md §4.6).

/profile used to fetch every recipe in the database and filter client-side.
These tests pin the scoping in SQL, and — more importantly — that `mine` is
scoped to the *authenticated* caller rather than anything client-supplied.
"""

from fastapi import APIRouter, FastAPI
from starlette.testclient import TestClient

from src.domain.entities import Ingredient, Ingredients, Recipe
from src.infra.adapters.repos.in_memory_recipe_repo import InMemoryRecipeRepository
from src.infra.controllers import RecipeController
from src.infra.security import TokenPayload, get_current_user

CALLER = "user-nel"
SOMEONE_ELSE = "user-martina"


def _client(caller: str = CALLER) -> TestClient:
    """Two recipes with *fixed* authors, so changing the caller changes which
    one is 'mine' — that's the whole property under test."""
    recipes = InMemoryRecipeRepository()
    for title, author in (("By nel", CALLER), ("By martina", SOMEONE_ELSE)):
        recipes.add_recipe(
            Recipe(
                title=title,
                instructions="Stir.",
                ingredients=Ingredients(servings=2, items=[Ingredient(name="salt")]),
                food_type="comida",
                created_by=author,
            )
        )

    router = APIRouter()
    RecipeController(recipes, router)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: TokenPayload(sub=caller, email="n@example.com", exp=9999999999)
    return TestClient(app)


def test_unfiltered_list_is_unchanged() -> None:
    response = _client().get("/recipes")

    assert response.status_code == 200
    assert {r["title"] for r in response.json()} == {"By nel", "By martina"}


def test_mine_returns_only_the_callers_recipes() -> None:
    response = _client().get("/recipes", params={"mine": "true"})

    assert response.status_code == 200
    assert [r["title"] for r in response.json()] == ["By nel"]


def test_mine_follows_the_token_not_the_request() -> None:
    """The scope comes from the JWT sub, so there's no parameter to tamper with."""
    response = _client(caller=SOMEONE_ELSE).get("/recipes", params={"mine": "true"})

    assert [r["title"] for r in response.json()] == ["By martina"]
