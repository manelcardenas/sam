from src.domain.ports import ReviewRepository


class DeleteReview:
    def __init__(self, review_repository: ReviewRepository) -> None:
        self.review_repository = review_repository

    def execute(self, review_id: str) -> None:
        self.review_repository.delete_review(review_id)
