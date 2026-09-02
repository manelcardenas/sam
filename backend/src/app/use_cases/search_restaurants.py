from src.domain.entities import RestaurantDetail, RestaurantFilters
from src.domain.ports import RestaurantRepository, ReviewRepository


class SearchRestaurants:
    def __init__(self, restaurant_repository: RestaurantRepository, review_repository: ReviewRepository) -> None:
        self.restaurant_repository = restaurant_repository
        self.review_repository = review_repository

    def execute(self, filters: RestaurantFilters | None = None) -> list[RestaurantDetail]:
        """List restaurants with their aggregate ratings, so list cards can show
        the score, who went and what they said without a per-restaurant fetch.

        Narrowing and ordering happen in the repository (they depend on review
        data); this only decorates the result. The repository's order is the
        render order — do not re-sort here."""
        restaurants = self.restaurant_repository.search_restaurants(filters)
        if not restaurants:
            return []
        aggregates = self.review_repository.aggregate_for_restaurants([r.id for r in restaurants])
        return [RestaurantDetail(**r.model_dump(), **(aggregates[r.id].model_dump() if r.id in aggregates else {})) for r in restaurants]
