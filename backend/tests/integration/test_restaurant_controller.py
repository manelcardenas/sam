"""Controller-boundary tests for RestaurantController.

Covers the two decisions that most diverge from the RecipeController pattern:
restaurant facts have no ownership check (see docs/adr/0002), while review
deletion is still author-only. Also covers the score validation (0-10 in
steps of 0.5) enforced at the request-schema boundary.
"""

import pytest
from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from src.infra.adapters.repos.in_memory_cuisine_repo import InMemoryCuisineRepository
from src.infra.adapters.repos.in_memory_restaurant_repo import InMemoryRestaurantRepository
from src.infra.adapters.repos.in_memory_review_repo import InMemoryReviewRepository
from src.infra.controllers.restaurant_controller import RestaurantController
from src.infra.controllers.schemas import CreateRestaurantRequest, CreateReviewRequest, UpdateRestaurantRequest
from src.infra.security.schemas import TokenPayload

USER = TokenPayload(sub="user-123", email="diner@example.com", exp=9999999999)
OTHER_USER = TokenPayload(sub="user-456", email="other@example.com", exp=9999999999)


def _controller() -> RestaurantController:
    return RestaurantController(
        InMemoryRestaurantRepository(),
        InMemoryReviewRepository(),
        InMemoryCuisineRepository(),
        APIRouter(),
    )


def _review_request(**overrides: object) -> CreateReviewRequest:
    defaults = {"location_score": 8, "food_score": 8, "service_score": 8, "value_score": 8, "visited_at": "2026-01-01"}
    defaults.update(overrides)
    return CreateReviewRequest(**defaults)


def test_create_restaurant_sets_created_by() -> None:
    controller = _controller()

    result = controller.create_restaurant(CreateRestaurantRequest(name="Casa Pepe"), current_user=USER)

    assert result.created_by == "user-123"


def test_update_restaurant_by_non_creator_succeeds() -> None:
    """Restaurant facts are open to any authenticated user — see docs/adr/0002."""
    controller = _controller()
    created = controller.create_restaurant(CreateRestaurantRequest(name="Casa Pepe"), current_user=USER)

    result = controller.update_restaurant(created.id, UpdateRestaurantRequest(name="Casa Pepe (fixed)"), _current_user=OTHER_USER)

    assert result.name == "Casa Pepe (fixed)"


def test_update_restaurant_not_found_raises_404() -> None:
    controller = _controller()

    with pytest.raises(HTTPException) as exc_info:
        controller.update_restaurant("missing", UpdateRestaurantRequest(name="X"), _current_user=USER)

    assert exc_info.value.status_code == 404


def test_create_review_for_missing_restaurant_raises_404() -> None:
    controller = _controller()

    with pytest.raises(HTTPException) as exc_info:
        controller.create_review("missing", _review_request(), current_user=USER)

    assert exc_info.value.status_code == 404


def test_get_restaurant_includes_computed_overall() -> None:
    controller = _controller()
    restaurant = controller.create_restaurant(CreateRestaurantRequest(name="Casa Pepe"), current_user=USER)
    controller.create_review(restaurant.id, _review_request(location_score=10, food_score=10, service_score=10, value_score=10), current_user=USER)

    detail = controller.get_restaurant(restaurant.id, _current_user=USER)

    assert detail.review_count == 1
    assert detail.average_overall == 10.0


def test_delete_review_by_author_succeeds() -> None:
    controller = _controller()
    restaurant = controller.create_restaurant(CreateRestaurantRequest(name="Casa Pepe"), current_user=USER)
    review = controller.create_review(restaurant.id, _review_request(), current_user=USER)

    controller.delete_review(restaurant.id, review.id, current_user=USER)

    assert controller.review_repository.get_review(review.id) is None


def test_delete_review_by_non_author_raises_403() -> None:
    controller = _controller()
    restaurant = controller.create_restaurant(CreateRestaurantRequest(name="Casa Pepe"), current_user=USER)
    review = controller.create_review(restaurant.id, _review_request(), current_user=USER)

    with pytest.raises(HTTPException) as exc_info:
        controller.delete_review(restaurant.id, review.id, current_user=OTHER_USER)

    assert exc_info.value.status_code == 403
    # Not deleted — the review should still exist.
    assert controller.review_repository.get_review(review.id) is not None


@pytest.mark.parametrize("bad_score", [7.3, -1, 10.5, 11])
def test_create_review_rejects_invalid_scores(bad_score: float) -> None:
    with pytest.raises(ValidationError):
        _review_request(location_score=bad_score)


def test_create_review_accepts_half_step_scores() -> None:
    request = _review_request(location_score=7.5, food_score=0, service_score=10, value_score=9.5)

    assert request.location_score == 7.5
