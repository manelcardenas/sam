from src.domain.entities import RestaurantDetail
from src.domain.ports import RestaurantRepository, ReviewRepository


class SearchRestaurants:
    def __init__(self, restaurant_repository: RestaurantRepository, review_repository: ReviewRepository) -> None:
        self.restaurant_repository = restaurant_repository
        self.review_repository = review_repository

    def execute(self, query: str | None = None) -> list[RestaurantDetail]:
        """List restaurants with their aggregate ratings, so list cards can show
        overall score and review count without a per-restaurant fetch."""
        restaurants = self.restaurant_repository.search_restaurants(query)
        if not restaurants:
            return []
        aggregates = self.review_repository.aggregate_for_restaurants([r.id for r in restaurants])
        return [RestaurantDetail(**r.model_dump(), **(aggregates[r.id].model_dump() if r.id in aggregates else {})) for r in restaurants]
