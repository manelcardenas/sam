from src.domain.entities import Restaurant
from src.domain.ports import RestaurantRepository


class SearchRestaurants:
    def __init__(self, restaurant_repository: RestaurantRepository) -> None:
        self.restaurant_repository = restaurant_repository

    def execute(self, query: str | None = None) -> list[Restaurant]:
        return self.restaurant_repository.search_restaurants(query)
