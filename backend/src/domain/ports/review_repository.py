from abc import ABC, abstractmethod

from src.domain.entities import Review


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
    def delete_review(self, review_id: str) -> None:
        pass
