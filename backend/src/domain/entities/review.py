import uuid
from datetime import UTC, date, datetime

from pydantic import BaseModel, Field, computed_field


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
