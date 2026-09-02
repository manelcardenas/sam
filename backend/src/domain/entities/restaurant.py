import uuid
from datetime import UTC, date, datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class Restaurant(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    address: str | None = None
    price_level: int | None = None  # 1-4, € to €€€€ — a fact about the venue, not a review score
    latitude: float | None = None  # copied from the picked Place when Mapped; None for Unmapped restaurants
    longitude: float | None = None  # copied from the picked Place when Mapped; None for Unmapped restaurants
    external_place_id: str | None = None  # Geoapify place id when Mapped (see docs/adr/0003); None for Unmapped restaurants
    cuisines: list[str] = Field(default_factory=list)
    created_by: str  # user ID of whoever added it — informational only, does not gate writes
    created_by_name: str | None = None  # creator's display_name, resolved via join
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class RestaurantDetail(Restaurant):
    """A Restaurant plus its computed aggregate ratings. Averages are never
    stored — always derived from the current set of Reviews."""

    review_count: int = 0
    average_location: float | None = None
    average_food: float | None = None
    average_service: float | None = None
    average_value: float | None = None
    average_overall: float | None = None
    last_visited_at: date | None = None
    reviewer_names: list[str] = Field(default_factory=list)
    last_comment: str | None = None
    last_comment_by: str | None = None
    last_comment_at: date | None = None


class RestaurantSort(StrEnum):
    RECENT = "recent"
    NAME = "name"


class RestaurantFilters(BaseModel):
    """How the dine list narrows and orders itself.."""

    query: str | None = None  # case-insensitive name match
    cuisines: list[str] = Field(default_factory=list)  # any-of
    price_levels: list[int] = Field(default_factory=list)  # any-of
    min_score: float | None = None  # floor on average overall; excludes unreviewed restaurants when set
    reviewed_by: str | None = None  # user id — restaurants this user has reviewed
    sort: RestaurantSort = RestaurantSort.RECENT

    @property
    def is_empty(self) -> bool:
        """True when nothing is being narrowed — used to decide whether the UI is showing the whole archive."""
        return not (self.query or self.cuisines or self.price_levels or self.min_score is not None or self.reviewed_by)
