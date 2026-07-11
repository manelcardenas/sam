from src.domain.entities import Review
from src.domain.ports import ReviewRepository


class CreateReview:
    def __init__(self, review_repository: ReviewRepository) -> None:
        self.review_repository = review_repository

    def execute(self, review: Review) -> Review:
        return self.review_repository.add_review(review)
