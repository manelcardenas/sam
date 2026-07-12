"""Controller-boundary tests for RestaurantController.

Covers the two decisions that most diverge from the RecipeController pattern:
restaurant facts have no ownership check (see docs/adr/0002), while review
deletion is still author-only. Also covers the score validation (0-10 in
steps of 0.5) enforced at the request-schema boundary.
"""

import pytest
from fastapi import APIRouter, HTTPException, Response, status
from pydantic import ValidationError

from src.domain.entities import Area, Cuisine, Place
from src.infra.adapters.places.in_memory_places_provider import InMemoryPlacesProvider
from src.infra.adapters.repos.in_memory_cuisine_repo import InMemoryCuisineRepository
from src.infra.adapters.repos.in_memory_restaurant_repo import InMemoryRestaurantRepository
from src.infra.adapters.repos.in_memory_review_repo import InMemoryReviewRepository
from src.infra.controllers.places_controller import PlacesController
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

    result = controller.create_restaurant(CreateRestaurantRequest(name="Casa Pepe"), Response(), current_user=USER)

    assert result.created_by == "user-123"


def test_update_restaurant_by_non_creator_succeeds() -> None:
    """Restaurant facts are open to any authenticated user — see docs/adr/0002."""
    controller = _controller()
    created = controller.create_restaurant(CreateRestaurantRequest(name="Casa Pepe"), Response(), current_user=USER)

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
    restaurant = controller.create_restaurant(CreateRestaurantRequest(name="Casa Pepe"), Response(), current_user=USER)
    controller.create_review(restaurant.id, _review_request(location_score=10, food_score=10, service_score=10, value_score=10), current_user=USER)

    detail = controller.get_restaurant(restaurant.id, _current_user=USER)

    assert detail.review_count == 1
    assert detail.average_overall == 10.0


def test_delete_review_by_author_succeeds() -> None:
    controller = _controller()
    restaurant = controller.create_restaurant(CreateRestaurantRequest(name="Casa Pepe"), Response(), current_user=USER)
    review = controller.create_review(restaurant.id, _review_request(), current_user=USER)

    controller.delete_review(restaurant.id, review.id, current_user=USER)

    assert controller.review_repository.get_review(review.id) is None


def test_delete_review_by_non_author_raises_403() -> None:
    controller = _controller()
    restaurant = controller.create_restaurant(CreateRestaurantRequest(name="Casa Pepe"), Response(), current_user=USER)
    review = controller.create_review(restaurant.id, _review_request(), current_user=USER)

    with pytest.raises(HTTPException) as exc_info:
        controller.delete_review(restaurant.id, review.id, current_user=OTHER_USER)

    assert exc_info.value.status_code == 403
    # Not deleted — the review should still exist.
    assert controller.review_repository.get_review(review.id) is not None


def test_update_review_by_author_replaces_fields_and_preserves_identity() -> None:
    controller = _controller()
    restaurant = controller.create_restaurant(CreateRestaurantRequest(name="Casa Pepe"), Response(), current_user=USER)
    review = controller.create_review(restaurant.id, _review_request(), current_user=USER)

    result = controller.update_review(
        restaurant.id,
        review.id,
        _review_request(location_score=10, food_score=10, service_score=10, value_score=9, comment="Even better this time"),
        current_user=USER,
    )

    assert result.id == review.id
    assert result.user_id == "user-123"
    assert result.created_at == review.created_at
    assert result.comment == "Even better this time"
    assert result.overall == 9.8  # recomputed server-side from the new scores


def test_update_review_by_non_author_raises_403() -> None:
    controller = _controller()
    restaurant = controller.create_restaurant(CreateRestaurantRequest(name="Casa Pepe"), Response(), current_user=USER)
    review = controller.create_review(restaurant.id, _review_request(), current_user=USER)

    with pytest.raises(HTTPException) as exc_info:
        controller.update_review(restaurant.id, review.id, _review_request(location_score=0), current_user=OTHER_USER)

    assert exc_info.value.status_code == 403
    # Untouched — the original scores must survive.
    assert controller.review_repository.get_review(review.id).location_score == 8


def test_update_review_under_wrong_restaurant_raises_404() -> None:
    controller = _controller()
    restaurant = controller.create_restaurant(CreateRestaurantRequest(name="Casa Pepe"), Response(), current_user=USER)
    other = controller.create_restaurant(CreateRestaurantRequest(name="La Mafia"), Response(), current_user=USER)
    review = controller.create_review(restaurant.id, _review_request(), current_user=USER)

    with pytest.raises(HTTPException) as exc_info:
        controller.update_review(other.id, review.id, _review_request(), current_user=USER)

    assert exc_info.value.status_code == 404


@pytest.mark.parametrize("bad_score", [7.3, -1, 10.5, 11])
def test_create_review_rejects_invalid_scores(bad_score: float) -> None:
    with pytest.raises(ValidationError):
        _review_request(location_score=bad_score)


def test_create_review_accepts_half_step_scores() -> None:
    request = _review_request(location_score=7.5, food_score=0, service_score=10, value_score=9.5)

    assert request.location_score == 7.5


def test_create_restaurant_with_unknown_cuisine_raises_422() -> None:
    """Unknown tags must fail loudly — the Postgres repo would drop them silently otherwise."""
    controller = _controller()

    with pytest.raises(HTTPException) as exc_info:
        controller.create_restaurant(CreateRestaurantRequest(name="Casa Pepe", cuisines=["Klingon"]), Response(), current_user=USER)

    assert exc_info.value.status_code == 422


def test_create_restaurant_with_known_cuisine_succeeds() -> None:
    controller = RestaurantController(
        InMemoryRestaurantRepository(),
        InMemoryReviewRepository(),
        InMemoryCuisineRepository([Cuisine(name="Italian")]),
        APIRouter(),
    )

    result = controller.create_restaurant(CreateRestaurantRequest(name="Casa Pepe", cuisines=["Italian"]), Response(), current_user=USER)

    assert result.cuisines == ["Italian"]


def test_create_restaurant_rejects_overlong_address() -> None:
    """Address is bounded at the schema (matching VARCHAR(500)) so users get a 422, not a DB 500."""
    with pytest.raises(ValidationError):
        CreateRestaurantRequest(name="Casa Pepe", address="a" * 501)


# ── Mapped restaurants (Places, see docs/adr/0003) ──────────────────────────


def _mapped_request(**overrides: object) -> CreateRestaurantRequest:
    defaults = {"name": "Casa Pepe", "external_place_id": "geo-1", "latitude": 41.4, "longitude": 2.15}
    defaults.update(overrides)
    return CreateRestaurantRequest(**defaults)


def test_create_mapped_restaurant_stores_identity_and_coords() -> None:
    controller = _controller()

    result = controller.create_restaurant(_mapped_request(), Response(), current_user=USER)

    assert result.external_place_id == "geo-1"
    assert result.latitude == 41.4
    assert result.longitude == 2.15


def test_create_with_known_place_returns_existing_with_200() -> None:
    """Idempotent create: picking a Place already on SAM must not duplicate it."""
    controller = _controller()
    first = controller.create_restaurant(_mapped_request(), Response(), current_user=USER)

    response = Response()
    second = controller.create_restaurant(_mapped_request(name="Casa Pepe (duplicate pick)"), response, current_user=OTHER_USER)

    assert second.id == first.id
    assert second.name == "Casa Pepe"  # the winner's facts, not the loser's payload
    assert response.status_code == status.HTTP_200_OK


def test_manual_creates_without_place_never_conflict() -> None:
    """Unmapped (manual) restaurants have no identity — same name twice is allowed (name dedup is UX-only)."""
    controller = _controller()
    first = controller.create_restaurant(CreateRestaurantRequest(name="Casa Pepe"), Response(), current_user=USER)
    second = controller.create_restaurant(CreateRestaurantRequest(name="Casa Pepe"), Response(), current_user=USER)

    assert first.id != second.id


def test_update_preserves_mapping_identity() -> None:
    """Facts are editable by anyone (ADR 0002), but the map link isn't part of the update payload."""
    controller = _controller()
    created = controller.create_restaurant(_mapped_request(), Response(), current_user=USER)

    result = controller.update_restaurant(created.id, UpdateRestaurantRequest(name="Casa Pepe (fixed)"), _current_user=OTHER_USER)

    assert result.external_place_id == "geo-1"
    assert result.latitude == 41.4


def test_update_can_pin_coordinates_on_an_unlocated_restaurant() -> None:
    """Pin drop on edit: sending both coords sets them, without granting a mapping identity."""
    controller = _controller()
    created = controller.create_restaurant(CreateRestaurantRequest(name="Casa Pepe"), Response(), current_user=USER)

    result = controller.update_restaurant(
        created.id,
        UpdateRestaurantRequest(name="Casa Pepe", latitude=41.65, longitude=-0.88),
        _current_user=OTHER_USER,
    )

    assert result.latitude == 41.65
    assert result.longitude == -0.88
    assert result.external_place_id is None


def test_update_without_coords_preserves_stored_pin() -> None:
    """Omitting coordinates means "unchanged" — older payloads can't wipe a location."""
    controller = _controller()
    created = controller.create_restaurant(_mapped_request(), Response(), current_user=USER)

    result = controller.update_restaurant(created.id, UpdateRestaurantRequest(name="Casa Pepe (fixed)"), _current_user=USER)

    assert result.latitude == 41.4
    assert result.longitude == 2.15


def _places_controller(places: list[Place]) -> PlacesController:
    return PlacesController(InMemoryPlacesProvider(places), APIRouter())


def test_search_places_matches_by_name() -> None:
    place = Place(external_place_id="geo-1", name="Casa Pepe", latitude=41.4, longitude=2.15)
    controller = _places_controller([place, Place(external_place_id="geo-2", name="Noodle Bar", latitude=41.4, longitude=2.15)])

    result = controller.search_places(q="casa", lat=None, lon=None, _current_user=USER)

    assert [p.external_place_id for p in result] == ["geo-1"]


def test_nearby_places_returns_seeded_places() -> None:
    place = Place(external_place_id="geo-1", name="Casa Pepe", latitude=41.4, longitude=2.15, distance_m=120)
    controller = _places_controller([place])

    result = controller.nearby_places(lat=41.4, lon=2.15, radius_m=500, _current_user=USER)

    assert len(result) == 1
    assert result[0].distance_m == 120


def test_search_areas_returns_matching_areas() -> None:
    area = Area(name="Zaragoza", label="Zaragoza, Aragon, Spain", latitude=41.65, longitude=-0.88)
    controller = PlacesController(InMemoryPlacesProvider(areas=[area]), APIRouter())

    result = controller.search_areas(q="zarag", _current_user=USER)

    assert len(result) == 1
    assert result[0].label == "Zaragoza, Aragon, Spain"


def test_reverse_geocode_returns_address_at_point() -> None:
    controller = PlacesController(InMemoryPlacesProvider(reverse_address="Calle Mayor 1, Zaragoza"), APIRouter())

    result = controller.reverse_geocode(lat=41.65, lon=-0.88, _current_user=USER)

    assert result.address == "Calle Mayor 1, Zaragoza"
