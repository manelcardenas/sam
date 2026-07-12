from abc import ABC, abstractmethod

from src.domain.entities import Review, ReviewAggregate


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
    def aggregate_for_restaurants(self, restaurant_ids: list[str]) -> dict[str, ReviewAggregate]:
        """Aggregate ratings per restaurant id; restaurants with no reviews are absent from the result."""
        pass

    @abstractmethod
    def delete_review(self, review_id: str) -> None:
        pass
