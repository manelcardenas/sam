"""HTTP-layer tests for the restaurant/user endpoints.

These exist because the unit tests call use cases directly and so never touch
FastAPI's query-param parsing — which is exactly where `GET /restaurants` broke:
a `ge`/`le` declared on a repeated param was applied to the list rather than its
elements, 500ing every request including the unfiltered default.
"""

from datetime import date

from fastapi import APIRouter, FastAPI
from starlette.testclient import TestClient

from src.domain.entities import Cuisine, Person, Restaurant, Review, User
from src.domain.ports import UserRepository
from src.infra.adapters.repos.in_memory_cuisine_repo import InMemoryCuisineRepository
from src.infra.adapters.repos.in_memory_restaurant_repo import InMemoryRestaurantRepository
from src.infra.adapters.repos.in_memory_review_repo import InMemoryReviewRepository
from src.infra.controllers import RestaurantController, UserController
from src.infra.security import TokenPayload, get_current_user

CALLER = "user-nel"


class StubUserRepository(UserRepository):
    """Only /users/me and /users/me (PUT) touch this; the review endpoints don't."""

    def ensure_user(self, user_id: str, email: str) -> None: ...

    def get_by_id(self, user_id: str) -> User | None:  # noqa: ARG002
        return None

    def list_people(self) -> list[Person]:
        return []

    def update_display_name(self, user_id: str, new_name: str) -> User:
        raise NotImplementedError


def _client() -> TestClient:
    reviews = InMemoryReviewRepository()
    restaurants = InMemoryRestaurantRepository(reviews)
    cuisines = InMemoryCuisineRepository([Cuisine(name="Japanese"), Cuisine(name="Italian")])

    casa = restaurants.add_restaurant(Restaurant(name="Casa Nostra", price_level=2, cuisines=["Italian"], created_by=CALLER))
    restaurants.add_restaurant(Restaurant(name="Sushi Bar", price_level=4, cuisines=["Japanese"], created_by=CALLER))
    reviews.add_review(
        Review(
            restaurant_id=casa.id,
            user_id=CALLER,
            location_score=8,
            food_score=9,
            service_score=7,
            value_score=8,
            comment="Great cacio e pepe",
            visited_at=date(2026, 8, 20),
        )
    )

    app = FastAPI()
    router = APIRouter()
    RestaurantController(restaurants, reviews, cuisines, router)
    UserController(StubUserRepository(), reviews, router)
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: TokenPayload(sub=CALLER, exp=0)
    return TestClient(app)


def test_unfiltered_list_returns_every_restaurant() -> None:
    """The regression: no query params at all must not 500."""
    response = _client().get("/restaurants")

    assert response.status_code == 200
    assert {r["name"] for r in response.json()} == {"Casa Nostra", "Sushi Bar"}


def test_filters_round_trip_through_the_query_string() -> None:
    client = _client()

    assert [r["name"] for r in client.get("/restaurants", params={"q": "casa"}).json()] == ["Casa Nostra"]
    assert [r["name"] for r in client.get("/restaurants", params={"cuisines": ["Japanese"]}).json()] == ["Sushi Bar"]
    assert [r["name"] for r in client.get("/restaurants", params={"price_levels": [4]}).json()] == ["Sushi Bar"]
    assert [r["name"] for r in client.get("/restaurants", params={"mine": "true"}).json()] == ["Casa Nostra"]


def test_repeated_price_levels_are_validated_per_element() -> None:
    client = _client()

    both = client.get("/restaurants", params={"price_levels": [2, 4]})
    assert both.status_code == 200
    assert len(both.json()) == 2

    # Out-of-range values are a client error, not a server one.
    assert client.get("/restaurants", params={"price_levels": [9]}).status_code == 422


def test_sort_param_is_accepted_and_validated() -> None:
    client = _client()

    for value in ("recent", "name", "rating"):
        assert client.get("/restaurants", params={"sort": value}).status_code == 200

    # An unknown ordering is a client error, not a silent fallback to the default.
    assert client.get("/restaurants", params={"sort": "cheapest"}).status_code == 422


def test_profile_endpoints_are_reachable() -> None:
    client = _client()

    reviews = client.get("/users/me/reviews")
    assert reviews.status_code == 200
    assert [r["comment"] for r in reviews.json()] == ["Great cacio e pepe"]

    stats = client.get("/users/me/stats")
    assert stats.status_code == 200
    assert stats.json()["reviews_written"] == 1
