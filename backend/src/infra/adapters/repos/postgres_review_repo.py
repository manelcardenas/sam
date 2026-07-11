import uuid

from sqlalchemy.orm import Session, sessionmaker

from src.domain.entities import Review
from src.domain.ports import ReviewRepository
from src.infra.adapters.repos.ids import parse_uuid
from src.infra.db import ReviewModel


class PostgresReviewRepository(ReviewRepository):
    """PostgreSQL-backed implementation of ReviewRepository.

    Uses a synchronous SQLAlchemy session per operation with NullPool,
    which is the correct pattern for Lambda: each call opens a fresh
    connection and closes it immediately, avoiding connection leaks.
    """

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def _to_entity(self, model: ReviewModel) -> Review:
        return Review(
            id=str(model.id),
            restaurant_id=str(model.restaurant_id),
            user_id=model.user_id,
            reviewer_name=model.reviewer.display_name if model.reviewer else None,
            location_score=float(model.location_score),
            food_score=float(model.food_score),
            service_score=float(model.service_score),
            value_score=float(model.value_score),
            comment=model.comment,
            visited_at=model.visited_at,
            created_at=model.created_at.isoformat(),
            updated_at=model.updated_at.isoformat(),
        )

    def add_review(self, review: Review) -> Review:
        with self._session_factory() as session:
            model = ReviewModel(
                restaurant_id=uuid.UUID(review.restaurant_id),
                user_id=review.user_id,
                location_score=review.location_score,
                food_score=review.food_score,
                service_score=review.service_score,
                value_score=review.value_score,
                comment=review.comment,
                visited_at=review.visited_at,
            )
            session.add(model)
            session.commit()
            session.refresh(model)
            return self._to_entity(model)

    def get_review(self, review_id: str) -> Review | None:
        uid = parse_uuid(review_id)
        if uid is None:
            return None
        with self._session_factory() as session:
            model = session.get(ReviewModel, uid)
            if model is None:
                return None
            return self._to_entity(model)

    def list_reviews_for_restaurant(self, restaurant_id: str) -> list[Review]:
        uid = parse_uuid(restaurant_id)
        if uid is None:
            return []
        with self._session_factory() as session:
            models = session.query(ReviewModel).filter(ReviewModel.restaurant_id == uid).order_by(ReviewModel.created_at.desc()).all()
            return [self._to_entity(m) for m in models]

    def delete_review(self, review_id: str) -> None:
        uid = parse_uuid(review_id)
        if uid is None:
            raise KeyError(f"Review with id {review_id} not found")
        with self._session_factory() as session:
            model = session.get(ReviewModel, uid)
            if model is None:
                raise KeyError(f"Review with id {review_id} not found")
            session.delete(model)
            session.commit()
