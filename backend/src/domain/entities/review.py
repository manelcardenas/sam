import uuid
from datetime import UTC, date, datetime

from pydantic import BaseModel, Field, computed_field

from src.domain.entities.user import Person


class Review(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    restaurant_id: str
    user_id: str
    reviewer_name: str | None = None  # reviewer's display_name, resolved via join
    location_score: float  # 0-10, step 0.5 — location/decoration
    food_score: float  # 0-10, step 0.5
    service_score: float  # 0-10, step 0.5
    value_score: float  # 0-10, step 0.5 — value for money, NOT price_level
    comment: str | None = None
    visited_at: date  # the date the reviewer says they went; defaults to today, chosen at creation time
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())

    @computed_field  # type: ignore[prop-decorator]
    @property
    def overall(self) -> float:
        """Average of the 4 category scores. Never entered directly, never stored — always computed."""
        return round((self.location_score + self.food_score + self.service_score + self.value_score) / 4, 1)


class ReviewAggregate(BaseModel):
    """Aggregate ratings for one Restaurant, computed from its Reviews — never stored.

    Field names deliberately mirror RestaurantDetail so the two can be merged
    with model_dump()."""

    review_count: int = 0
    average_location: float | None = None
    average_food: float | None = None
    average_service: float | None = None
    average_value: float | None = None
    average_overall: float | None = None
    last_visited_at: date | None = None  # newest visited_at; also the default sort key for the list
    reviewer_names: list[str] = Field(default_factory=list)  # distinct reviewers, alphabetical
    reviewers: list[Person] = Field(default_factory=list)  # the same people with their ids, same order — what "Reviewed by" offers
    last_comment: str | None = None
    last_comment_by: str | None = None
    last_comment_at: date | None = None


class UserStats(BaseModel):
    """Everything the profile's stats strip shows, computed from a user's Reviews."""

    reviews_written: int = 0
    places_reviewed: int = 0  # distinct restaurants, which differs from reviews_written because revisits are allowed
    average_score_given: float | None = None
    top_cuisine: str | None = None  # most frequent cuisine across the restaurants reviewed


class UserReview(Review):
    """A Review carrying the name of the restaurant it belongs to.

    Used only by the profile's "your reviews" list: the rows are read outside a
    restaurant's page, so each needs to say where it was — resolved via join
    rather than a per-row lookup from the frontend."""

    restaurant_name: str
