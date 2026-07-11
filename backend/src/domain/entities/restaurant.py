import uuid
from datetime import UTC, datetime

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
