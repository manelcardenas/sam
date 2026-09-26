from collections import Counter

from src.domain.entities import Person, Review, ReviewAggregate, UserReview, UserStats
from src.domain.ports import ReviewRepository


def _average(values: list[float]) -> float:
    return round(sum(values) / len(values), 1)


class InMemoryReviewRepository(ReviewRepository):
    """In-memory repository for unit tests only.

    Not used in production. Allows use-case tests to run without
    any database or Docker dependency.
    """

    def __init__(self) -> None:
        self.table: dict[str, dict] = {}
        self.user_names: dict[str, str] = {}
        self.restaurant_names: dict[str, str] = {}
        self.restaurant_cuisines: dict[str, list[str]] = {}

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

    def list_reviews_by_user(self, user_id: str) -> list[UserReview]:
        reviews = [Review(**data) for data in self.table.values() if data["user_id"] == user_id]
        reviews.sort(key=lambda r: (r.visited_at, r.created_at), reverse=True)
        return [
            UserReview(
                **review.model_dump(exclude={"overall"}),
                restaurant_name=self.restaurant_names.get(review.restaurant_id, ""),
            )
            for review in reviews
        ]

    def _reviewer_name(self, review: Review) -> str | None:
        return review.reviewer_name or self.user_names.get(review.user_id)

    def aggregate_for_restaurants(self, restaurant_ids: list[str]) -> dict[str, ReviewAggregate]:
        result: dict[str, ReviewAggregate] = {}
        for restaurant_id in restaurant_ids:
            reviews = self.list_reviews_for_restaurant(restaurant_id)
            if not reviews:
                continue

            # Mirrors the Postgres DISTINCT ON: newest review that has a comment,
            # ties within a visit date broken by created_at.
            commented = sorted(
                (r for r in reviews if r.comment and r.comment.strip()),
                key=lambda r: (r.visited_at, r.created_at),
                reverse=True,
            )
            latest_comment = commented[0] if commented else None

            named = {r.user_id: name for r in reviews if (name := self._reviewer_name(r))}
            reviewers = sorted((Person(id=user_id, display_name=name) for user_id, name in named.items()), key=lambda person: person.display_name)

            result[restaurant_id] = ReviewAggregate(
                review_count=len(reviews),
                average_location=_average([r.location_score for r in reviews]),
                average_food=_average([r.food_score for r in reviews]),
                average_service=_average([r.service_score for r in reviews]),
                average_value=_average([r.value_score for r in reviews]),
                average_overall=_average([r.overall for r in reviews]),
                last_visited_at=max(r.visited_at for r in reviews),
                reviewer_names=[person.display_name for person in reviewers],
                reviewers=reviewers,
                last_comment=latest_comment.comment if latest_comment else None,
                last_comment_by=self._reviewer_name(latest_comment) if latest_comment else None,
                last_comment_at=latest_comment.visited_at if latest_comment else None,
            )
        return result

    def stats_for_user(self, user_id: str) -> UserStats:
        reviews = [Review(**data) for data in self.table.values() if data["user_id"] == user_id]
        if not reviews:
            return UserStats()

        restaurant_ids = {r.restaurant_id for r in reviews}
        # Counted over distinct restaurants, matching the Postgres adapter, so
        # revisits don't inflate a cuisine.
        cuisine_counts = Counter(cuisine for rid in restaurant_ids for cuisine in self.restaurant_cuisines.get(rid, []))
        top_cuisine = min(cuisine_counts.items(), key=lambda kv: (-kv[1], kv[0]))[0] if cuisine_counts else None

        return UserStats(
            reviews_written=len(reviews),
            places_reviewed=len(restaurant_ids),
            average_score_given=_average([r.overall for r in reviews]),
            top_cuisine=top_cuisine,
        )

    def update_review(self, review: Review) -> Review:
        existing = self.table.get(review.id)
        if existing is None:
            raise KeyError(f"Review with id {review.id} not found")
        # Only the author-editable facts change; identity/authorship/created_at stay.
        existing.update(
            location_score=review.location_score,
            food_score=review.food_score,
            service_score=review.service_score,
            value_score=review.value_score,
            comment=review.comment,
            visited_at=review.visited_at,
        )
        return Review(**existing)

    def delete_review(self, review_id: str) -> None:
        if review_id not in self.table:
            raise KeyError(f"Review with id {review_id} not found")

        del self.table[review_id]
