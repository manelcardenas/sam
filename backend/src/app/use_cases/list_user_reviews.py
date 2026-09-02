from src.domain.entities import UserReview
from src.domain.ports import ReviewRepository


class ListUserReviews:
    def __init__(self, review_repository: ReviewRepository) -> None:
        self.review_repository = review_repository

    def execute(self, user_id: str) -> list[UserReview]:
        """Every review a user has written, newest visit first — the profile's
        "your reviews" list. Each row carries its restaurant's name so the list
        reads on its own, away from any restaurant page."""
        return self.review_repository.list_reviews_by_user(user_id)
