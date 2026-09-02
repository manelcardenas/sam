from abc import ABC, abstractmethod

from src.domain.entities import Review, ReviewAggregate, UserReview, UserStats


class ReviewRepository(ABC):
    @abstractmethod
    def add_review(self, review: Review) -> Review:
        pass

    @abstractmethod
    def get_review(self, review_id: str) -> Review | None:
        pass

    @abstractmethod
    def list_reviews_for_restaurant(self, restaurant_id: str) -> list[Review]:
        pass

    @abstractmethod
    def list_reviews_by_user(self, user_id: str) -> list[UserReview]:
        """Every review this user has written, newest visit first, each carrying its restaurant's name."""
        pass

    @abstractmethod
    def aggregate_for_restaurants(self, restaurant_ids: list[str]) -> dict[str, ReviewAggregate]:
        """Aggregate ratings per restaurant id; restaurants with no reviews are absent from the result."""
        pass

    @abstractmethod
    def stats_for_user(self, user_id: str) -> UserStats:
        """Headline counts for the profile stats strip. Returns zeroed stats for a user with no reviews."""
        pass

    @abstractmethod
    def delete_review(self, review_id: str) -> None:
        pass
