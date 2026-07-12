from src.domain.entities import RestaurantDetail
from src.domain.ports import RestaurantRepository, ReviewRepository


class GetRestaurant:
    def __init__(self, restaurant_repository: RestaurantRepository, review_repository: ReviewRepository) -> None:
        self.restaurant_repository = restaurant_repository
        self.review_repository = review_repository

    def execute(self, restaurant_id: str) -> RestaurantDetail | None:
        restaurant = self.restaurant_repository.get_restaurant(restaurant_id)
        if restaurant is None:
            return None

        aggregate = self.review_repository.aggregate_for_restaurants([restaurant_id]).get(restaurant_id)
        return RestaurantDetail(**restaurant.model_dump(), **(aggregate.model_dump() if aggregate else {}))
