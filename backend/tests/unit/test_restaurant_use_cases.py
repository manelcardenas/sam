import pytest

from src.app.use_cases import (
    CreateRestaurant,
    CreateReview,
    DeleteReview,
    GetRestaurant,
    GetReview,
    GetUserStats,
    ListCuisines,
    ListReviews,
    ListUserReviews,
    NearbyPlaces,
    SearchAreas,
    SearchPlaces,
    SearchRestaurants,
    UpdateRestaurant,
)
from src.domain.entities import Area, Cuisine, Place, Restaurant, RestaurantFilters, RestaurantSort, Review
from src.infra.adapters.places.in_memory_places_provider import InMemoryPlacesProvider
from src.infra.adapters.repos.in_memory_cuisine_repo import InMemoryCuisineRepository
from src.infra.adapters.repos.in_memory_restaurant_repo import InMemoryRestaurantRepository
from src.infra.adapters.repos.in_memory_review_repo import InMemoryReviewRepository


@pytest.fixture
def review_repo() -> InMemoryReviewRepository:
    return InMemoryReviewRepository()


@pytest.fixture
def restaurant_repo(review_repo: InMemoryReviewRepository) -> InMemoryRestaurantRepository:
    # Wired to the review repo so the score/reviewer filters and the recency sort
    # behave as they do against Postgres, where they resolve in one joined query.
    return InMemoryRestaurantRepository(reviews=review_repo)


@pytest.fixture
def sample_restaurant() -> Restaurant:
    return Restaurant(name="Casa Pepe", address="Carrer Gran 1", created_by="user-123")


class TestCreateRestaurant:
    def test_creates_restaurant_successfully(self, restaurant_repo: InMemoryRestaurantRepository, sample_restaurant: Restaurant) -> None:
        result, created = CreateRestaurant(restaurant_repo).execute(sample_restaurant)

        assert created is True
        assert result.id == sample_restaurant.id
        assert result.name == "Casa Pepe"
        assert result.created_by == "user-123"

    def test_same_place_picked_twice_returns_existing(self, restaurant_repo: InMemoryRestaurantRepository) -> None:
        """Idempotent on external_place_id — the unique-index backstop for picker dedup (docs/adr/0003)."""
        first, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Casa Pepe", external_place_id="geo-1", created_by="user-1"))

        second, created = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Casa Pepe Again", external_place_id="geo-1", created_by="user-2"))

        assert created is False
        assert second.id == first.id
        assert len(restaurant_repo.table) == 1

    def test_unmapped_restaurants_never_conflict(self, restaurant_repo: InMemoryRestaurantRepository) -> None:
        first, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Casa Pepe", created_by="user-1"))
        second, created = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Casa Pepe", created_by="user-2"))

        assert created is True
        assert second.id != first.id


class TestSearchRestaurants:
    def test_filters_by_case_insensitive_name(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        CreateRestaurant(restaurant_repo).execute(Restaurant(name="Casa Pepe", created_by="user-1"))
        CreateRestaurant(restaurant_repo).execute(Restaurant(name="Noodle Bar", created_by="user-1"))

        result = SearchRestaurants(restaurant_repo, review_repo).execute(RestaurantFilters(query="casa"))

        assert len(result) == 1
        assert result[0].name == "Casa Pepe"

    def test_returns_all_when_no_query(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        CreateRestaurant(restaurant_repo).execute(Restaurant(name="Casa Pepe", created_by="user-1"))
        CreateRestaurant(restaurant_repo).execute(Restaurant(name="Noodle Bar", created_by="user-1"))

        result = SearchRestaurants(restaurant_repo, review_repo).execute()

        assert len(result) == 2

    def test_includes_aggregate_ratings_per_restaurant(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        """List cards show overall + review count, so the list must carry aggregates."""
        reviewed, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Casa Pepe", created_by="user-1"))
        CreateRestaurant(restaurant_repo).execute(Restaurant(name="Noodle Bar", created_by="user-1"))
        CreateReview(review_repo).execute(
            Review(restaurant_id=reviewed.id, user_id="user-a", location_score=8, food_score=8, service_score=8, value_score=8, visited_at="2026-01-01")
        )
        CreateReview(review_repo).execute(
            Review(restaurant_id=reviewed.id, user_id="user-b", location_score=10, food_score=10, service_score=10, value_score=10, visited_at="2026-01-02")
        )

        result = {r.name: r for r in SearchRestaurants(restaurant_repo, review_repo).execute()}

        assert result["Casa Pepe"].review_count == 2
        assert result["Casa Pepe"].average_overall == 9.0
        assert result["Noodle Bar"].review_count == 0
        assert result["Noodle Bar"].average_overall is None


class TestUpdateRestaurant:
    def test_any_user_can_update_facts(self, restaurant_repo: InMemoryRestaurantRepository, sample_restaurant: Restaurant) -> None:
        """Restaurant facts are open to any authenticated user — see docs/adr/0002."""
        created, _ = CreateRestaurant(restaurant_repo).execute(sample_restaurant)

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
        created, _ = CreateRestaurant(restaurant_repo).execute(sample_restaurant)
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
        created, _ = CreateRestaurant(restaurant_repo).execute(sample_restaurant)

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
        created, _ = CreateRestaurant(restaurant_repo).execute(sample_restaurant)
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


class TestPlaces:
    """Places are ephemeral provider results — never stored, only searched (see CONTEXT.md)."""

    @pytest.fixture
    def places_provider(self) -> InMemoryPlacesProvider:
        return InMemoryPlacesProvider(
            [
                Place(external_place_id="geo-1", name="Casa Pepe", address="Carrer Gran 1", latitude=41.4, longitude=2.15, cuisines=["spanish"]),
                Place(external_place_id="geo-2", name="Noodle Bar", latitude=41.41, longitude=2.16),
            ]
        )

    def test_search_matches_case_insensitively(self, places_provider: InMemoryPlacesProvider) -> None:
        result = SearchPlaces(places_provider).execute("casa")

        assert [p.external_place_id for p in result] == ["geo-1"]
        assert result[0].cuisines == ["spanish"]

    def test_nearby_returns_places(self, places_provider: InMemoryPlacesProvider) -> None:
        result = NearbyPlaces(places_provider).execute(41.4, 2.15)

        assert len(result) == 2

    def test_search_areas_matches_by_name(self) -> None:
        provider = InMemoryPlacesProvider(
            areas=[
                Area(name="Zaragoza", label="Zaragoza, Aragon, Spain", latitude=41.65, longitude=-0.88),
                Area(name="Barcelona", label="Barcelona, Catalonia, Spain", latitude=41.39, longitude=2.17),
            ]
        )

        result = SearchAreas(provider).execute("zara")

        assert [a.name for a in result] == ["Zaragoza"]


class TestListCuisines:
    def test_returns_seeded_cuisines(self) -> None:
        repo = InMemoryCuisineRepository([Cuisine(name="Italian"), Cuisine(name="Japanese")])

        result = ListCuisines(repo).execute()

        assert [c.name for c in result] == ["Italian", "Japanese"]


def _review(restaurant_id: str, user_id: str, visited_at: str, score: float = 8, comment: str | None = None) -> Review:
    return Review(
        restaurant_id=restaurant_id,
        user_id=user_id,
        location_score=score,
        food_score=score,
        service_score=score,
        value_score=score,
        comment=comment,
        visited_at=visited_at,
    )


class TestScrapbookOrderingAndFilters:
    """The dine list is a record of meals, ordered by when you were there (docs/adr/0005)."""

    def test_orders_by_most_recent_visit(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        old, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Aaa Old Place", created_by="user-1"))
        recent, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Zzz Recent Place", created_by="user-1"))
        CreateReview(review_repo).execute(_review(old.id, "user-a", "2026-01-01"))
        CreateReview(review_repo).execute(_review(recent.id, "user-a", "2026-08-01"))

        result = SearchRestaurants(restaurant_repo, review_repo).execute()

        # Alphabetically "Aaa" would win; recency puts the August visit first.
        assert [r.name for r in result] == ["Zzz Recent Place", "Aaa Old Place"]

    def test_unreviewed_restaurants_sort_last_but_are_not_hidden(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        """They must stay findable to ever receive a first review."""
        CreateRestaurant(restaurant_repo).execute(Restaurant(name="Aaa Never Reviewed", created_by="user-1"))
        reviewed, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Zzz Reviewed", created_by="user-1"))
        CreateReview(review_repo).execute(_review(reviewed.id, "user-a", "2026-01-01"))

        result = SearchRestaurants(restaurant_repo, review_repo).execute()

        assert [r.name for r in result] == ["Zzz Reviewed", "Aaa Never Reviewed"]

    def test_sort_by_name_is_still_available(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        recent, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Zzz Recent", created_by="user-1"))
        CreateRestaurant(restaurant_repo).execute(Restaurant(name="Aaa Old", created_by="user-1"))
        CreateReview(review_repo).execute(_review(recent.id, "user-a", "2026-08-01"))

        result = SearchRestaurants(restaurant_repo, review_repo).execute(RestaurantFilters(sort=RestaurantSort.NAME))

        assert [r.name for r in result] == ["Aaa Old", "Zzz Recent"]

    def test_sort_by_rating_puts_the_highest_score_first(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        good, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Zzz Good", created_by="user-1"))
        poor, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Aaa Poor", created_by="user-1"))
        CreateReview(review_repo).execute(_review(good.id, "user-a", "2026-01-01", score=9))
        CreateReview(review_repo).execute(_review(poor.id, "user-a", "2026-08-01", score=4))

        result = SearchRestaurants(restaurant_repo, review_repo).execute(RestaurantFilters(sort=RestaurantSort.RATING))

        # Neither alphabetical nor recency order — the 9 beats the 4 despite
        # "Aaa" sorting first and having the newer visit.
        assert [r.name for r in result] == ["Zzz Good", "Aaa Poor"]

    def test_sort_by_oldest_reverses_the_recency_order(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        recent, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Aaa Recent", created_by="user-1"))
        old, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Zzz Old", created_by="user-1"))
        CreateReview(review_repo).execute(_review(recent.id, "user-a", "2026-08-01"))
        CreateReview(review_repo).execute(_review(old.id, "user-a", "2026-01-01"))

        result = SearchRestaurants(restaurant_repo, review_repo).execute(RestaurantFilters(sort=RestaurantSort.OLDEST))

        # Alphabetically "Aaa" would win here too, so this only passes if the
        # visit date is doing the work.
        assert [r.name for r in result] == ["Zzz Old", "Aaa Recent"]

    def test_never_visited_still_sorts_last_under_oldest(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        """The whole reason direction isn't a flag.

        "Never visited" is not "visited longest ago". Flipping the sort would
        put an unvisited restaurant at the top of this list and imply it was the
        most overdue, which is the opposite of what the data says.
        """
        CreateRestaurant(restaurant_repo).execute(Restaurant(name="Aaa Never Visited", created_by="user-1"))
        visited, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Zzz Visited Once", created_by="user-1"))
        CreateReview(review_repo).execute(_review(visited.id, "user-a", "2026-01-01"))

        result = SearchRestaurants(restaurant_repo, review_repo).execute(RestaurantFilters(sort=RestaurantSort.OLDEST))

        assert [r.name for r in result] == ["Zzz Visited Once", "Aaa Never Visited"]

    def test_sort_by_rating_low_puts_the_worst_score_first(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        good, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Aaa Good", created_by="user-1"))
        poor, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Zzz Poor", created_by="user-1"))
        CreateReview(review_repo).execute(_review(good.id, "user-a", "2026-01-01", score=9))
        CreateReview(review_repo).execute(_review(poor.id, "user-a", "2026-08-01", score=4))

        result = SearchRestaurants(restaurant_repo, review_repo).execute(RestaurantFilters(sort=RestaurantSort.RATING_LOW))

        assert [r.name for r in result] == ["Zzz Poor", "Aaa Good"]

    def test_unreviewed_still_sorts_last_under_rating_low(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        """No score is not the worst score, so it does not lead this list."""
        CreateRestaurant(restaurant_repo).execute(Restaurant(name="Aaa Never Reviewed", created_by="user-1"))
        poor, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Zzz Poor", created_by="user-1"))
        CreateReview(review_repo).execute(_review(poor.id, "user-a", "2026-01-01", score=2))

        result = SearchRestaurants(restaurant_repo, review_repo).execute(RestaurantFilters(sort=RestaurantSort.RATING_LOW))

        assert [r.name for r in result] == ["Zzz Poor", "Aaa Never Reviewed"]

    def test_rating_low_ties_still_break_on_review_count_descending(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        """The tie-break is not mirrored: more evidence wins in both directions."""
        one_review, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Aaa One Voice", created_by="user-1"))
        three_reviews, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Zzz Three Agree", created_by="user-1"))
        CreateReview(review_repo).execute(_review(one_review.id, "user-a", "2026-08-01", score=3))
        for user in ("user-a", "user-b", "user-c"):
            CreateReview(review_repo).execute(_review(three_reviews.id, user, "2026-01-01", score=3))

        result = SearchRestaurants(restaurant_repo, review_repo).execute(RestaurantFilters(sort=RestaurantSort.RATING_LOW))

        assert [r.name for r in result] == ["Zzz Three Agree", "Aaa One Voice"]

    def test_rating_ties_break_on_review_count(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        """Equal scores: the better-evidenced one wins, not the alphabetically luckier one."""
        one_review, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Aaa One Voice", created_by="user-1"))
        three_reviews, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Zzz Three Agree", created_by="user-1"))
        CreateReview(review_repo).execute(_review(one_review.id, "user-a", "2026-08-01", score=8))
        for user in ("user-a", "user-b", "user-c"):
            CreateReview(review_repo).execute(_review(three_reviews.id, user, "2026-01-01", score=8))

        result = SearchRestaurants(restaurant_repo, review_repo).execute(RestaurantFilters(sort=RestaurantSort.RATING))

        assert [r.name for r in result] == ["Zzz Three Agree", "Aaa One Voice"]

    def test_rating_ties_on_score_and_count_fall_back_to_name(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        """Without a final tie-break the order would vary between requests."""
        b, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Bbb", created_by="user-1"))
        a, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Aaa", created_by="user-1"))
        CreateReview(review_repo).execute(_review(b.id, "user-a", "2026-08-01", score=7))
        CreateReview(review_repo).execute(_review(a.id, "user-a", "2026-01-01", score=7))

        result = SearchRestaurants(restaurant_repo, review_repo).execute(RestaurantFilters(sort=RestaurantSort.RATING))

        assert [r.name for r in result] == ["Aaa", "Bbb"]

    def test_rating_sort_keeps_unrated_restaurants_last_not_hidden(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        """No score is not a zero score — but it can't outrank a real one either."""
        CreateRestaurant(restaurant_repo).execute(Restaurant(name="Aaa Unrated", created_by="user-1"))
        low, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Zzz Barely Liked", created_by="user-1"))
        CreateReview(review_repo).execute(_review(low.id, "user-a", "2026-01-01", score=2))

        result = SearchRestaurants(restaurant_repo, review_repo).execute(RestaurantFilters(sort=RestaurantSort.RATING))

        assert [r.name for r in result] == ["Zzz Barely Liked", "Aaa Unrated"]

    def test_rating_sort_composes_with_filters(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        """Sorting orders whatever the chips selected — it must not widen the set."""
        best, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Best Italian", cuisines=["Italian"], created_by="user-1"))
        CreateRestaurant(restaurant_repo).execute(Restaurant(name="Better Chinese", cuisines=["Chinese"], created_by="user-1"))
        ok, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Ok Italian", cuisines=["Italian"], created_by="user-1"))
        CreateReview(review_repo).execute(_review(best.id, "user-a", "2026-01-01", score=9))
        CreateReview(review_repo).execute(_review(ok.id, "user-a", "2026-01-01", score=6))

        result = SearchRestaurants(restaurant_repo, review_repo).execute(RestaurantFilters(cuisines=["Italian"], sort=RestaurantSort.RATING))

        assert [r.name for r in result] == ["Best Italian", "Ok Italian"]

    def test_filters_by_cuisine_any_of(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        CreateRestaurant(restaurant_repo).execute(Restaurant(name="Wok", cuisines=["Chinese"], created_by="user-1"))
        CreateRestaurant(restaurant_repo).execute(Restaurant(name="Trattoria", cuisines=["Italian", "Mediterranean"], created_by="user-1"))
        CreateRestaurant(restaurant_repo).execute(Restaurant(name="Taqueria", cuisines=["Mexican"], created_by="user-1"))

        result = SearchRestaurants(restaurant_repo, review_repo).execute(RestaurantFilters(cuisines=["Chinese", "Mediterranean"]))

        assert {r.name for r in result} == {"Wok", "Trattoria"}

    def test_filters_by_price_level(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        CreateRestaurant(restaurant_repo).execute(Restaurant(name="Cheap", price_level=1, created_by="user-1"))
        CreateRestaurant(restaurant_repo).execute(Restaurant(name="Fancy", price_level=4, created_by="user-1"))

        result = SearchRestaurants(restaurant_repo, review_repo).execute(RestaurantFilters(price_levels=[4]))

        assert [r.name for r in result] == ["Fancy"]

    def test_min_score_excludes_unreviewed_restaurants(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        """A score floor is a statement about quality — 'no score' can't clear it."""
        good, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Good", created_by="user-1"))
        poor, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Poor", created_by="user-1"))
        CreateRestaurant(restaurant_repo).execute(Restaurant(name="Unrated", created_by="user-1"))
        CreateReview(review_repo).execute(_review(good.id, "user-a", "2026-01-01", score=9))
        CreateReview(review_repo).execute(_review(poor.id, "user-a", "2026-01-01", score=4))

        result = SearchRestaurants(restaurant_repo, review_repo).execute(RestaurantFilters(min_score=8))

        assert [r.name for r in result] == ["Good"]

    def test_reviewed_by_returns_only_that_users_places(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        mine, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Mine", created_by="user-1"))
        theirs, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Theirs", created_by="user-1"))
        CreateReview(review_repo).execute(_review(mine.id, "user-a", "2026-01-01"))
        CreateReview(review_repo).execute(_review(theirs.id, "user-b", "2026-01-01"))

        result = SearchRestaurants(restaurant_repo, review_repo).execute(RestaurantFilters(reviewed_by=["user-a"]))

        assert [r.name for r in result] == ["Mine"]

    def test_reviewed_by_several_people_is_any_of(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        """Any-of, the same OR-within-one-axis rule as cuisines: reviewed by Nel or Martina."""
        a, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="A", created_by="user-1"))
        b, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="B", created_by="user-1"))
        c, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="C", created_by="user-1"))
        CreateReview(review_repo).execute(_review(a.id, "user-a", "2026-01-01"))
        CreateReview(review_repo).execute(_review(b.id, "user-b", "2026-01-02"))
        CreateReview(review_repo).execute(_review(c.id, "user-c", "2026-01-03"))

        result = SearchRestaurants(restaurant_repo, review_repo).execute(RestaurantFilters(reviewed_by=["user-a", "user-b"]))

        assert sorted(r.name for r in result) == ["A", "B"]


class TestScrapbookCardContent:
    """Cards carry the human traces of a visit, not just the venue's facts."""

    def test_surfaces_latest_visit_and_reviewers(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        restaurant, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Casa Pepe", created_by="user-1"))
        review_repo.user_names = {"user-a": "Nel", "user-b": "Martina"}
        CreateReview(review_repo).execute(_review(restaurant.id, "user-a", "2026-03-01"))
        CreateReview(review_repo).execute(_review(restaurant.id, "user-b", "2026-07-15"))

        [result] = SearchRestaurants(restaurant_repo, review_repo).execute()

        assert str(result.last_visited_at) == "2026-07-15"
        assert result.reviewer_names == ["Martina", "Nel"]
        # The same people with their ids, in the same order — what the
        # "Reviewed by" dropdown is built from.
        assert [(p.id, p.display_name) for p in result.reviewers] == [("user-b", "Martina"), ("user-a", "Nel")]

    def test_a_reviewer_without_a_name_is_left_out_of_both_lists(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        restaurant, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Casa Pepe", created_by="user-1"))
        review_repo.user_names = {"user-a": "Nel"}
        CreateReview(review_repo).execute(_review(restaurant.id, "user-a", "2026-03-01"))
        CreateReview(review_repo).execute(_review(restaurant.id, "user-a", "2026-04-01"))
        CreateReview(review_repo).execute(_review(restaurant.id, "user-nameless", "2026-05-01"))

        [result] = SearchRestaurants(restaurant_repo, review_repo).execute()

        assert result.reviewer_names == ["Nel"]
        assert [p.id for p in result.reviewers] == ["user-a"]

    def test_quote_comes_from_the_newest_review_that_has_one(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        """Most recent reviews often carry no comment; the card shows the newest
        one that does, attributed to that visit rather than the latest."""
        restaurant, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Casa Pepe", created_by="user-1"))
        review_repo.user_names = {"user-a": "Nel", "user-b": "Martina"}
        CreateReview(review_repo).execute(_review(restaurant.id, "user-a", "2026-03-01", comment="the dumplings were unreal"))
        CreateReview(review_repo).execute(_review(restaurant.id, "user-b", "2026-07-15", comment=None))

        [result] = SearchRestaurants(restaurant_repo, review_repo).execute()

        assert result.last_comment == "the dumplings were unreal"
        assert result.last_comment_by == "Nel"
        assert str(result.last_comment_at) == "2026-03-01"
        # The visit date is still the newest visit, not the quoted one.
        assert str(result.last_visited_at) == "2026-07-15"

    def test_blank_comments_do_not_count_as_a_quote(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        restaurant, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Casa Pepe", created_by="user-1"))
        CreateReview(review_repo).execute(_review(restaurant.id, "user-a", "2026-03-01", comment="   "))

        [result] = SearchRestaurants(restaurant_repo, review_repo).execute()

        assert result.last_comment is None


class TestProfileReviewsAndStats:
    def test_lists_a_users_reviews_newest_visit_first_with_restaurant_names(
        self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository
    ) -> None:
        casa, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Casa Pepe", created_by="user-1"))
        wok, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Wok", created_by="user-1"))
        review_repo.restaurant_names = {casa.id: "Casa Pepe", wok.id: "Wok"}
        CreateReview(review_repo).execute(_review(casa.id, "user-a", "2026-01-01"))
        CreateReview(review_repo).execute(_review(wok.id, "user-a", "2026-06-01"))
        CreateReview(review_repo).execute(_review(casa.id, "user-b", "2026-09-01"))

        result = ListUserReviews(review_repo).execute("user-a")

        assert [(r.restaurant_name, str(r.visited_at)) for r in result] == [("Wok", "2026-06-01"), ("Casa Pepe", "2026-01-01")]

    def test_stats_count_revisits_once_for_places_but_twice_for_reviews(
        self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository
    ) -> None:
        casa, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Casa Pepe", cuisines=["Spanish"], created_by="user-1"))
        review_repo.restaurant_cuisines = {casa.id: ["Spanish"]}
        CreateReview(review_repo).execute(_review(casa.id, "user-a", "2026-01-01", score=8))
        CreateReview(review_repo).execute(_review(casa.id, "user-a", "2026-06-01", score=6))

        result = GetUserStats(review_repo).execute("user-a")

        assert result.reviews_written == 2
        assert result.places_reviewed == 1
        assert result.average_score_given == 7.0
        assert result.top_cuisine == "Spanish"

    def test_top_cuisine_counts_distinct_places_not_visits(self, restaurant_repo: InMemoryRestaurantRepository, review_repo: InMemoryReviewRepository) -> None:
        """Three visits to one Spanish place shouldn't outrank two different Chinese ones."""
        casa, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Casa Pepe", cuisines=["Spanish"], created_by="user-1"))
        wok, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Wok", cuisines=["Chinese"], created_by="user-1"))
        noodle, _ = CreateRestaurant(restaurant_repo).execute(Restaurant(name="Noodle", cuisines=["Chinese"], created_by="user-1"))
        review_repo.restaurant_cuisines = {casa.id: ["Spanish"], wok.id: ["Chinese"], noodle.id: ["Chinese"]}
        for visited in ("2026-01-01", "2026-02-01", "2026-03-01"):
            CreateReview(review_repo).execute(_review(casa.id, "user-a", visited))
        CreateReview(review_repo).execute(_review(wok.id, "user-a", "2026-04-01"))
        CreateReview(review_repo).execute(_review(noodle.id, "user-a", "2026-05-01"))

        result = GetUserStats(review_repo).execute("user-a")

        assert result.top_cuisine == "Chinese"

    def test_stats_are_zeroed_for_a_user_with_no_reviews(self, review_repo: InMemoryReviewRepository) -> None:
        result = GetUserStats(review_repo).execute("user-nobody")

        assert result.reviews_written == 0
        assert result.places_reviewed == 0
        assert result.average_score_given is None
        assert result.top_cuisine is None
