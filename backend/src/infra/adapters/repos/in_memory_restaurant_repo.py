from datetime import UTC, datetime

from src.domain.entities import Restaurant, RestaurantFilters, RestaurantSort
from src.domain.ports import DuplicateExternalPlaceError, RestaurantRepository, ReviewRepository


class InMemoryRestaurantRepository(RestaurantRepository):
    """In-memory repository for unit tests only.

    Not used in production. Allows use-case tests to run without
    any database or Docker dependency.
    """

    def __init__(self, reviews: ReviewRepository | None = None) -> None:
        self.table: dict[str, dict] = {}
        self.reviews = reviews

    def add_restaurant(self, restaurant: Restaurant) -> Restaurant:
        # Simulates the partial unique index on external_place_id.
        if restaurant.external_place_id is not None and self.find_by_external_place_id(restaurant.external_place_id) is not None:
            raise DuplicateExternalPlaceError(restaurant.external_place_id)
        self.table[restaurant.id] = restaurant.model_dump()
        return Restaurant(**self.table[restaurant.id])  # New instance each time. Prevents accidental mutations of the in-memory dict.

    def find_by_external_place_id(self, external_place_id: str) -> Restaurant | None:
        for data in self.table.values():
            if data["external_place_id"] == external_place_id:
                return Restaurant(**data)
        return None

    def get_restaurant(self, restaurant_id: str) -> Restaurant | None:
        data = self.table.get(restaurant_id)
        if data is None:
            return None
        return Restaurant(**data)

    def search_restaurants(self, filters: RestaurantFilters | None = None) -> list[Restaurant]:
        filters = filters or RestaurantFilters()
        restaurants = [Restaurant(**data) for data in self.table.values()]

        if filters.query:
            query_lower = filters.query.lower()
            restaurants = [r for r in restaurants if query_lower in r.name.lower()]
        if filters.cuisines:
            wanted = set(filters.cuisines)
            restaurants = [r for r in restaurants if wanted & set(r.cuisines)]
        if filters.price_levels:
            restaurants = [r for r in restaurants if r.price_level in filters.price_levels]

        # Review-derived filters and the recency sort need review data, which this
        # repository doesn't hold. Tests that exercise them inject a review
        # repository via `reviews`; without one, they're no-ops and the order
        # falls back to name.
        if self.reviews is not None:
            if filters.reviewed_by:
                restaurants = [r for r in restaurants if any(review.user_id in filters.reviewed_by for review in self.reviews.list_reviews_for_restaurant(r.id))]
            aggregates = self.reviews.aggregate_for_restaurants([r.id for r in restaurants])
            if filters.min_score is not None:
                restaurants = [
                    r for r in restaurants if (agg := aggregates.get(r.id)) is not None and agg.average_overall is not None and agg.average_overall >= filters.min_score
                ]
            # In every branch the leading boolean pushes rows with no value to
            # the end the way the SQL's NULLS LAST does, instead of letting them
            # sort as 0 — including in the ascending orderings, where sorting as
            # 0 would rank an unreviewed restaurant as the worst one.
            if filters.sort in (RestaurantSort.RATING, RestaurantSort.RATING_LOW):
                # Mirrors the SQL: score, then review count desc, then name.
                direction = 1 if filters.sort is RestaurantSort.RATING_LOW else -1
                return sorted(
                    restaurants,
                    key=lambda r: (
                        (agg := aggregates.get(r.id)) is None or agg.average_overall is None,
                        direction * (agg.average_overall if agg and agg.average_overall is not None else 0),
                        # Not mirrored: the better-evidenced verdict wins either way.
                        -(agg.review_count if agg else 0),
                        r.name,
                    ),
                )

            if filters.sort in (RestaurantSort.RECENT, RestaurantSort.OLDEST):
                # None sorts last, matching the SQL's NULLS LAST; name breaks ties.
                direction = 1 if filters.sort is RestaurantSort.OLDEST else -1
                return sorted(
                    restaurants,
                    key=lambda r: (
                        (agg := aggregates.get(r.id)) is None or agg.last_visited_at is None,
                        direction * (agg.last_visited_at.toordinal() if agg and agg.last_visited_at else 0),
                        r.name,
                    ),
                )

        return sorted(restaurants, key=lambda r: r.name)

    def update_restaurant(self, restaurant: Restaurant) -> Restaurant:
        if restaurant.id not in self.table:
            raise KeyError(f"Restaurant with id {restaurant.id} not found")

        data = restaurant.model_dump()
        data["updated_at"] = datetime.now(UTC).isoformat()
        self.table[restaurant.id] = data

        return Restaurant(**self.table[restaurant.id])
