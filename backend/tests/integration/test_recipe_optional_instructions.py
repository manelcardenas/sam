"""Instructions are optional, and "no method" has exactly one spelling.

A recipe you already know how to make needs only its ingredients to be worth
saving: the meal planner can put it in a slot and its ingredients still land on
the shopping list. That is all docs/adr/0007 survives as — the *lens* that once
sorted rows into "recipes" and "dishes" is gone, and with it the `?kind=` filter.

What still has to hold is the normalisation. `""`, `"   "` and a missing key are
three spellings of the same fact, and if the first two reach the database the
detail view renders an Instructions heading over nothing — the orphan-heading bug
that started all this. One spelling behind the API, so no reader has to test for
three.
"""

import pytest
from fastapi import APIRouter, FastAPI
from starlette.testclient import TestClient

from src.domain.entities import Ingredient, Ingredients, Recipe
from src.infra.adapters.repos.in_memory_recipe_repo import InMemoryRecipeRepository
from src.infra.controllers import RecipeController
from src.infra.security import TokenPayload, get_current_user

CALLER = "user-nel"

BODY = {
    "title": "Lentejas",
    "ingredients": {"servings": 4, "items": [{"name": "lentejas", "amount": 400, "unit": "g"}]},
    "food_type": "comida",
}


@pytest.fixture
def repository() -> InMemoryRecipeRepository:
    return InMemoryRecipeRepository()


@pytest.fixture
def client(repository: InMemoryRecipeRepository) -> TestClient:
    router = APIRouter()
    RecipeController(repository, router)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: TokenPayload(sub=CALLER, email="n@example.com", exp=9999999999)
    return TestClient(app)


def _seed(repository: InMemoryRecipeRepository, title: str, instructions: str | None) -> Recipe:
    return repository.add_recipe(
        Recipe(
            title=title,
            instructions=instructions,
            ingredients=Ingredients(servings=2, items=[Ingredient(name="sal")]),
            food_type="comida",
            created_by=CALLER,
        )
    )


class TestSavingWithoutAMethod:
    def test_omitting_instructions_is_accepted(self, client: TestClient) -> None:
        response = client.post("/recipes", json=BODY)

        assert response.status_code == 201
        assert response.json()["instructions"] is None

    @pytest.mark.parametrize("blank", ["", "   ", "\n\t "])
    def test_blank_instructions_are_stored_as_null_not_as_empty_text(self, client: TestClient, blank: str) -> None:
        """The load-bearing one.

        Stored as `""`, this row renders an Instructions heading with nothing
        under it, and every reader downstream — the detail view, the form, the
        planner — has to test for emptiness rather than for NULL.
        """
        response = client.post("/recipes", json={**BODY, "instructions": blank})

        assert response.status_code == 201
        assert response.json()["instructions"] is None

    def test_instructions_are_still_stored_when_given(self, client: TestClient) -> None:
        response = client.post("/recipes", json={**BODY, "instructions": "  Simmer for an hour.  "})

        assert response.status_code == 201
        assert response.json()["instructions"] == "Simmer for an hour."


class TestTheListHoldsBoth:
    def test_a_recipe_with_no_method_is_in_the_list_like_any_other(self, client: TestClient, repository: InMemoryRecipeRepository) -> None:
        """There is no second collection to fall into any more.

        While the lens existed, a row with no instructions was invisible on
        /dashboard until you tapped a chip. Now one list holds everything, so
        this is the property that replaces the whole `?kind=` suite.
        """
        _seed(repository, "Lentejas", "Soak overnight.")
        _seed(repository, "Pasta al pesto", None)

        titles = [r["title"] for r in client.get("/recipes").json()]

        assert sorted(titles) == ["Lentejas", "Pasta al pesto"]

    def test_kind_is_no_longer_a_filter_and_is_ignored_rather_than_honoured(self, client: TestClient, repository: InMemoryRecipeRepository) -> None:
        """A stale link or a bookmarked `?kind=dish` must not hide anything.

        FastAPI drops unknown query params, so this passes by construction —
        it is here to fail if somebody reintroduces the parameter without
        reintroducing the concept behind it.
        """
        _seed(repository, "Lentejas", "Soak overnight.")
        _seed(repository, "Pasta al pesto", None)

        assert len(client.get("/recipes", params={"kind": "dish"}).json()) == 2


class TestWritingTheMethodInLater:
    def test_instructions_can_be_added_to_a_recipe_that_had_none(self, client: TestClient, repository: InMemoryRecipeRepository) -> None:
        recipe = _seed(repository, "Lentejas", None)

        client.put(f"/recipes/{recipe.id}", json={**BODY, "instructions": "Soak overnight, then simmer."})

        assert client.get(f"/recipes/{recipe.id}").json()["instructions"] == "Soak overnight, then simmer."

    def test_instructions_can_be_cleared_again(self, client: TestClient, repository: InMemoryRecipeRepository) -> None:
        """Clearing has to normalise too, or the round trip leaves `""` behind."""
        recipe = _seed(repository, "Lentejas", "Soak overnight.")

        client.put(f"/recipes/{recipe.id}", json={**BODY, "instructions": ""})

        assert client.get(f"/recipes/{recipe.id}").json()["instructions"] is None
