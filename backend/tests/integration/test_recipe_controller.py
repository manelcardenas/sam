"""Controller-boundary tests for RecipeController.

These cover the schema -> domain-entity conversion that the unit tests skip
(they build `Recipe` directly). In particular: the request schemas type
`source_url` as Pydantic `HttpUrl`, but the `Recipe` entity stores a plain
`str` — the controller must convert, or `Recipe(...)` raises a string_type
validation error. Regression test for that 500 on create/update with a source.
"""

import pytest
from fastapi import APIRouter, HTTPException

from src.infra.adapters.repos.in_memory_recipe_repo import InMemoryRecipeRepository
from src.infra.controllers.recipe_controller import RecipeController
from src.infra.controllers.schemas import CreateRecipeRequest, UpdateRecipeRequest
from src.infra.security.schemas import TokenPayload

SOURCE = "https://recetasdecocina.elmundo.es/2020/01/tortitas.html"
USER = TokenPayload(sub="user-123", email="cook@example.com", exp=9999999999)
OTHER_USER = TokenPayload(sub="user-456", email="other@example.com", exp=9999999999)
INGREDIENTS = {"servings": 2, "items": [{"name": "flour"}]}


def _controller() -> RecipeController:
    return RecipeController(InMemoryRecipeRepository(), APIRouter())


def test_create_recipe_with_source_url_returns_str() -> None:
    controller = _controller()
    request = CreateRecipeRequest(
        title="Pancakes",
        instructions="Mix.",
        ingredients=INGREDIENTS,
        food_type="postre",
        source_url=SOURCE,
    )

    result = controller.create_recipe(request, current_user=USER)

    assert isinstance(result.source_url, str)
    assert result.source_url == SOURCE
    assert result.created_by == "user-123"


def test_create_recipe_without_source_url_is_none() -> None:
    controller = _controller()
    request = CreateRecipeRequest(title="Hummus", instructions="Blend.", ingredients=INGREDIENTS, food_type="aperitivo")

    result = controller.create_recipe(request, current_user=USER)

    assert result.source_url is None


def test_update_recipe_with_source_url_returns_str() -> None:
    controller = _controller()
    created = controller.create_recipe(
        CreateRecipeRequest(title="Pancakes", instructions="Mix.", ingredients=INGREDIENTS, food_type="postre"),
        current_user=USER,
    )

    update = UpdateRecipeRequest(
        title="Pancakes",
        instructions="Mix well.",
        ingredients=INGREDIENTS,
        food_type="postre",
        source_url=SOURCE,
    )
    result = controller.update_recipe(created.id, update, current_user=USER)

    assert isinstance(result.source_url, str)
    assert result.source_url == SOURCE


def test_update_recipe_clearing_source_url_sets_none() -> None:
    controller = _controller()
    created = controller.create_recipe(
        CreateRecipeRequest(title="Pancakes", instructions="Mix.", ingredients=INGREDIENTS, food_type="postre", source_url=SOURCE),
        current_user=USER,
    )

    update = UpdateRecipeRequest(title="Pancakes", instructions="Mix.", ingredients=INGREDIENTS, food_type="postre")
    result = controller.update_recipe(created.id, update, current_user=USER)

    assert result.source_url is None


def test_update_recipe_by_non_creator_raises_403() -> None:
    controller = _controller()
    created = controller.create_recipe(
        CreateRecipeRequest(title="Pancakes", instructions="Mix.", ingredients=INGREDIENTS, food_type="postre"),
        current_user=USER,
    )
    update = UpdateRecipeRequest(title="Hacked", instructions="Mix.", ingredients=INGREDIENTS, food_type="postre")

    with pytest.raises(HTTPException) as exc_info:
        controller.update_recipe(created.id, update, current_user=OTHER_USER)

    assert exc_info.value.status_code == 403


def test_delete_recipe_by_creator_succeeds() -> None:
    controller = _controller()
    created = controller.create_recipe(
        CreateRecipeRequest(title="Pancakes", instructions="Mix.", ingredients=INGREDIENTS, food_type="postre"),
        current_user=USER,
    )

    controller.delete_recipe(created.id, current_user=USER)

    assert controller.recipe_repository.get_recipe(created.id) is None


def test_delete_recipe_by_non_creator_raises_403() -> None:
    controller = _controller()
    created = controller.create_recipe(
        CreateRecipeRequest(title="Pancakes", instructions="Mix.", ingredients=INGREDIENTS, food_type="postre"),
        current_user=USER,
    )

    with pytest.raises(HTTPException) as exc_info:
        controller.delete_recipe(created.id, current_user=OTHER_USER)

    assert exc_info.value.status_code == 403
    # Not deleted — the recipe should still exist.
    assert controller.recipe_repository.get_recipe(created.id) is not None
