from src.domain.entities import Restaurant
from src.domain.ports import RestaurantRepository


class CreateRestaurant:
    def __init__(self, restaurant_repository: RestaurantRepository) -> None:
        self.restaurant_repository = restaurant_repository

    def execute(self, restaurant: Restaurant) -> Restaurant:
        return self.restaurant_repository.add_restaurant(restaurant)
