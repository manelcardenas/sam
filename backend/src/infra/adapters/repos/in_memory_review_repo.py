from src.domain.entities import Review
from src.domain.ports import ReviewRepository


class InMemoryReviewRepository(ReviewRepository):
    """In-memory repository for unit tests only.

    Not used in production. Allows use-case tests to run without
    any database or Docker dependency.
    """

    def __init__(self) -> None:
        self.table: dict[str, dict] = {}

    def add_review(self, review: Review) -> Review:
        self.table[review.id] = review.model_dump()
        return Review(**self.table[review.id])  # New instance each time. Prevents accidental mutations of the in-memory dict.

    def get_review(self, review_id: str) -> Review | None:
        data = self.table.get(review_id)
        if data is None:
            return None
        return Review(**data)

    def list_reviews_for_restaurant(self, restaurant_id: str) -> list[Review]:
        return [Review(**data) for data in self.table.values() if data["restaurant_id"] == restaurant_id]

    def delete_review(self, review_id: str) -> None:
        if review_id not in self.table:
            raise KeyError(f"Review with id {review_id} not found")

        del self.table[review_id]
