from src.domain.entities import UserStats
from src.domain.ports import ReviewRepository


class GetUserStats:
    def __init__(self, review_repository: ReviewRepository) -> None:
        self.review_repository = review_repository

    def execute(self, user_id: str) -> UserStats:
        """Headline figures for the profile's stats strip. A user with no reviews
        gets zeroed stats rather than an error — the strip still renders."""
        return self.review_repository.stats_for_user(user_id)
