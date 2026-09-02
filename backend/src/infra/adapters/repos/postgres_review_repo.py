import uuid

from sqlalchemy import desc, distinct, func
from sqlalchemy.orm import Session, sessionmaker

from src.domain.entities import Review, ReviewAggregate, UserReview, UserStats
from src.domain.ports import ReviewRepository
from src.infra.adapters.repos.ids import parse_uuid
from src.infra.db import CuisineModel, RestaurantModel, ReviewModel, UserModel
from src.infra.db.models import restaurant_cuisines


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

    def aggregate_for_restaurants(self, restaurant_ids: list[str]) -> dict[str, ReviewAggregate]:
        ids = [uid for uid in (parse_uuid(r) for r in restaurant_ids) if uid is not None]
        if not ids:
            return {}
        # Per-review overall is rounded to 1dp before averaging, matching Review.overall,
        # so list cards and the detail view can never disagree on the same data.
        overall = func.round((ReviewModel.location_score + ReviewModel.food_score + ReviewModel.service_score + ReviewModel.value_score) / 4, 1)
        with self._session_factory() as session:
            # Two batched queries over the whole id list — never per restaurant.
            # Keeping them separate rather than one clever join: the first is a
            # GROUP BY over every review, the second picks exactly one row per
            # restaurant, and fusing them would need a window function for no
            # measurable gain at this size.
            rows = (
                session.query(
                    ReviewModel.restaurant_id,
                    func.count(ReviewModel.id),
                    func.avg(ReviewModel.location_score),
                    func.avg(ReviewModel.food_score),
                    func.avg(ReviewModel.service_score),
                    func.avg(ReviewModel.value_score),
                    func.avg(overall),
                    func.max(ReviewModel.visited_at),
                    func.array_remove(func.array_agg(distinct(UserModel.display_name)), None),
                )
                .join(UserModel, UserModel.id == ReviewModel.user_id, isouter=True)
                .filter(ReviewModel.restaurant_id.in_(ids))
                .group_by(ReviewModel.restaurant_id)
                .all()
            )

            # The newest review that actually carries a comment — see ReviewAggregate
            # for why this is not simply the newest review. DISTINCT ON is Postgres's
            # "first row per group"; created_at breaks ties within one visit date.
            comment_rows = (
                session.query(
                    ReviewModel.restaurant_id,
                    ReviewModel.comment,
                    ReviewModel.visited_at,
                    UserModel.display_name,
                )
                .join(UserModel, UserModel.id == ReviewModel.user_id, isouter=True)
                .filter(
                    ReviewModel.restaurant_id.in_(ids),
                    ReviewModel.comment.isnot(None),
                    func.trim(ReviewModel.comment) != "",
                )
                .distinct(ReviewModel.restaurant_id)
                .order_by(ReviewModel.restaurant_id, ReviewModel.visited_at.desc(), ReviewModel.created_at.desc())
                .all()
            )

        latest_comments = {str(restaurant_id): (comment, visited_at, name) for restaurant_id, comment, visited_at, name in comment_rows}

        aggregates: dict[str, ReviewAggregate] = {}
        for restaurant_id, count, avg_location, avg_food, avg_service, avg_value, avg_overall, last_visited_at, reviewers in rows:
            key = str(restaurant_id)
            comment, comment_at, comment_by = latest_comments.get(key, (None, None, None))
            aggregates[key] = ReviewAggregate(
                review_count=count,
                average_location=round(float(avg_location), 1),
                average_food=round(float(avg_food), 1),
                average_service=round(float(avg_service), 1),
                average_value=round(float(avg_value), 1),
                average_overall=round(float(avg_overall), 1),
                last_visited_at=last_visited_at,
                reviewer_names=sorted(reviewers or []),
                last_comment=comment,
                last_comment_by=comment_by,
                last_comment_at=comment_at,
            )
        return aggregates

    def list_reviews_by_user(self, user_id: str) -> list[UserReview]:
        with self._session_factory() as session:
            rows = (
                session.query(ReviewModel, RestaurantModel.name)
                .join(RestaurantModel, RestaurantModel.id == ReviewModel.restaurant_id)
                .filter(ReviewModel.user_id == user_id)
                .order_by(ReviewModel.visited_at.desc(), ReviewModel.created_at.desc())
                .all()
            )
            return [UserReview(**self._to_entity(model).model_dump(exclude={"overall"}), restaurant_name=name) for model, name in rows]

    def stats_for_user(self, user_id: str) -> UserStats:
        overall = (ReviewModel.location_score + ReviewModel.food_score + ReviewModel.service_score + ReviewModel.value_score) / 4
        with self._session_factory() as session:
            totals = (
                session.query(
                    func.count(ReviewModel.id),
                    func.count(distinct(ReviewModel.restaurant_id)),
                    func.avg(overall),
                )
                .filter(ReviewModel.user_id == user_id)
                .one()
            )
            reviews_written, places_reviewed, average_given = totals
            if not reviews_written:
                return UserStats()

            # Most-reviewed cuisine, counted over distinct restaurants so three
            # visits to the same place don't crown its cuisine on their own.
            top = (
                session.query(CuisineModel.name, func.count(distinct(ReviewModel.restaurant_id)).label("n"))
                .select_from(ReviewModel)
                .join(RestaurantModel, RestaurantModel.id == ReviewModel.restaurant_id)
                .join(restaurant_cuisines, restaurant_cuisines.c.restaurant_id == RestaurantModel.id)
                .join(CuisineModel, CuisineModel.id == restaurant_cuisines.c.cuisine_id)
                .filter(ReviewModel.user_id == user_id)
                .group_by(CuisineModel.name)
                .order_by(desc("n"), CuisineModel.name)  # name breaks ties deterministically
                .first()
            )

        return UserStats(
            reviews_written=reviews_written,
            places_reviewed=places_reviewed,
            average_score_given=round(float(average_given), 1) if average_given is not None else None,
            top_cuisine=top[0] if top else None,
        )

    def update_review(self, review: Review) -> Review:
        uid = parse_uuid(review.id)
        if uid is None:
            raise KeyError(f"Review with id {review.id} not found")
        with self._session_factory() as session:
            model = session.get(ReviewModel, uid)
            if model is None:
                raise KeyError(f"Review with id {review.id} not found")
            # Only the author-editable facts — identity, authorship and
            # created_at never change (updated_at bumps via onupdate).
            model.location_score = review.location_score
            model.food_score = review.food_score
            model.service_score = review.service_score
            model.value_score = review.value_score
            model.comment = review.comment
            model.visited_at = review.visited_at
            session.commit()
            session.refresh(model)
            return self._to_entity(model)

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
