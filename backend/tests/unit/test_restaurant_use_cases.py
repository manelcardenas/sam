import pytest

from src.app.use_cases import (
    CreateRestaurant,
    CreateReview,
    DeleteReview,
    GetRestaurant,
    GetReview,
    ListCuisines,
    ListReviews,
    SearchRestaurants,
    UpdateRestaurant,
)
from src.domain.entities import Cuisine, Restaurant, Review
from src.infra.adapters.repos.in_memory_cuisine_repo import InMemoryCuisineRepository
from src.infra.adapters.repos.in_memory_restaurant_repo import InMemoryRestaurantRepository
from src.infra.adapters.repos.in_memory_review_repo import InMemoryReviewRepository


@pytest.fixture
def restaurant_repo() -> InMemoryRestaurantRepository:
    return InMemoryRestaurantRepository()


@pytest.fixture
def review_repo() -> InMemoryReviewRepository:
    return InMemoryReviewRepository()


@pytest.fixture
def sample_restaurant() -> Restaurant:
    return Restaurant(name="Casa Pepe", address="Carrer Gran 1", created_by="user-123")


class TestCreateRestaurant:
    def test_creates_restaurant_successfully(self, restaurant_repo: InMemoryRestaurantRepository, sample_restaurant: Restaurant) -> None:
        result = CreateRestaurant(restaurant_repo).execute(sample_restaurant)

        assert result.id == sample_restaurant.id
        assert result.name == "Casa Pepe"
        assert result.created_by == "user-123"


class TestSearchRestaurants:
    def test_filters_by_case_insensitive_name(self, restaurant_repo: InMemoryRestaurantRepository) -> None:
        CreateRestaurant(restaurant_repo).execute(Restaurant(name="Casa Pepe", created_by="user-1"))
        CreateRestaurant(restaurant_repo).execute(Restaurant(name="Noodle Bar", created_by="user-1"))

        result = SearchRestaurants(restaurant_repo).execute("casa")

        assert len(result) == 1
        assert result[0].name == "Casa Pepe"

    def test_returns_all_when_no_query(self, restaurant_repo: InMemoryRestaurantRepository) -> None:
        CreateRestaurant(restaurant_repo).execute(Restaurant(name="Casa Pepe", created_by="user-1"))
        CreateRestaurant(restaurant_repo).execute(Restaurant(name="Noodle Bar", created_by="user-1"))

        result = SearchRestaurants(restaurant_repo).execute()

        assert len(result) == 2


class TestUpdateRestaurant:
    def test_any_user_can_update_facts(self, restaurant_repo: InMemoryRestaurantRepository, sample_restaurant: Restaurant) -> None:
        """Restaurant facts are open to any authenticated user — see docs/adr/0002."""
        created = CreateRestaurant(restaurant_repo).execute(sample_restaurant)

        updated = Restaurant(
            id=created.id,
            name="Casa Pepe (renamed)",
            address=created.address,
            created_by=created.created_by,
            created_at=created.created_at,
        )
        result = UpdateRestaurant(restaurant_repo).execute(updated)

        assert result.name == "Casa Pepe (renamed)"


class TestGetRestaurant:
    def test_returns_none_when_not_found(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        assert GetRestaurant(restaurant_repo, review_repo).execute("missing") is None

    def test_computes_aggregate_ratings_across_reviews(
        self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository, sample_restaurant: Restaurant
    ) -> None:
        created = CreateRestaurant(restaurant_repo).execute(sample_restaurant)
        CreateReview(review_repo).execute(
            Review(restaurant_id=created.id, user_id="user-a", location_score=8, food_score=6, service_score=10, value_score=8, visited_at="2026-01-01")
        )
        CreateReview(review_repo).execute(
            Review(restaurant_id=created.id, user_id="user-b", location_score=10, food_score=10, service_score=10, value_score=10, visited_at="2026-01-02")
        )

        detail = GetRestaurant(restaurant_repo, review_repo).execute(created.id)

        assert detail is not None
        assert detail.review_count == 2
        assert detail.average_location == 9.0
        assert detail.average_food == 8.0
        assert detail.average_overall == 9.0  # review overalls are 8.0 and 10.0

    def test_no_aggregates_when_no_reviews(
        self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository, sample_restaurant: Restaurant
    ) -> None:
        created = CreateRestaurant(restaurant_repo).execute(sample_restaurant)

        detail = GetRestaurant(restaurant_repo, review_repo).execute(created.id)

        assert detail is not None
        assert detail.review_count == 0
        assert detail.average_overall is None


class TestReviewOverall:
    def test_overall_is_average_of_four_categories(self) -> None:
        review = Review(restaurant_id="r1", user_id="u1", location_score=10, food_score=8, service_score=6, value_score=4, visited_at="2026-01-01")

        assert review.overall == 7.0


class TestReviewLifecycle:
    def test_a_user_can_post_multiple_reviews_of_the_same_restaurant(
        self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository, sample_restaurant: Restaurant
    ) -> None:
        created = CreateRestaurant(restaurant_repo).execute(sample_restaurant)
        CreateReview(review_repo).execute(
            Review(restaurant_id=created.id, user_id="user-a", location_score=5, food_score=5, service_score=5, value_score=5, visited_at="2026-01-01")
        )
        CreateReview(review_repo).execute(
            Review(restaurant_id=created.id, user_id="user-a", location_score=9, food_score=9, service_score=9, value_score=9, visited_at="2026-02-01")
        )

        reviews = ListReviews(review_repo).execute(created.id)

        assert len(reviews) == 2

    def test_delete_review(self, review_repo: InMemoryReviewRepository) -> None:
        created = CreateReview(review_repo).execute(
            Review(restaurant_id="r1", user_id="user-a", location_score=5, food_score=5, service_score=5, value_score=5, visited_at="2026-01-01")
        )

        DeleteReview(review_repo).execute(created.id)

        assert GetReview(review_repo).execute(created.id) is None

    def test_delete_raises_when_not_found(self, review_repo: InMemoryReviewRepository) -> None:
        with pytest.raises(KeyError):
            DeleteReview(review_repo).execute("missing")


class TestListCuisines:
    def test_returns_seeded_cuisines(self) -> None:
        repo = InMemoryCuisineRepository([Cuisine(name="Italian"), Cuisine(name="Japanese")])

        result = ListCuisines(repo).execute()

        assert [c.name for c in result] == ["Italian", "Japanese"]
