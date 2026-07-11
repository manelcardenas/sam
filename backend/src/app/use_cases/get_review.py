from src.domain.entities import Review
from src.domain.ports import ReviewRepository


class GetReview:
    def __init__(self, review_repository: ReviewRepository) -> None:
        self.review_repository = review_repository

    def execute(self, review_id: str) -> Review | None:
        return self.review_repository.get_review(review_id)
