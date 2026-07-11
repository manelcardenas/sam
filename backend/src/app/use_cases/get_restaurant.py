from collections.abc import Iterable

from src.domain.entities import RestaurantDetail
from src.domain.ports import RestaurantRepository, ReviewRepository


def _average(values: Iterable[float]) -> float:
    values = list(values)
    return round(sum(values) / len(values), 1)


class GetRestaurant:
    def __init__(self, restaurant_repository: RestaurantRepository, review_repository: ReviewRepository) -> None:
        self.restaurant_repository = restaurant_repository
        self.review_repository = review_repository

    def execute(self, restaurant_id: str) -> RestaurantDetail | None:
        restaurant = self.restaurant_repository.get_restaurant(restaurant_id)
        if restaurant is None:
            return None

        reviews = self.review_repository.list_reviews_for_restaurant(restaurant_id)
        detail = RestaurantDetail(**restaurant.model_dump(), review_count=len(reviews))
        if reviews:
            detail.average_location = _average(r.location_score for r in reviews)
            detail.average_food = _average(r.food_score for r in reviews)
            detail.average_service = _average(r.service_score for r in reviews)
            detail.average_value = _average(r.value_score for r in reviews)
            detail.average_overall = _average(r.overall for r in reviews)
        return detail
