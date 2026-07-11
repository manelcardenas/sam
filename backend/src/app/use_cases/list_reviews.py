from src.domain.entities import Review
from src.domain.ports import ReviewRepository


class ListReviews:
    def __init__(self, review_repository: ReviewRepository) -> None:
        self.review_repository = review_repository

    def execute(self, restaurant_id: str) -> list[Review]:
        return self.review_repository.list_reviews_for_restaurant(restaurant_id)
