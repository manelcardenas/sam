from datetime import date

from pydantic import BaseModel, Field, field_validator


def _validate_score(v: float) -> float:
    if not (0 <= v <= 10):
        raise ValueError("Score must be between 0 and 10")
    doubled = v * 2
    if abs(doubled - round(doubled)) > 1e-9:
        raise ValueError("Score must be in steps of 0.5")
    return v


class CreateReviewRequest(BaseModel):
    """Request body for submitting or editing a review (PUT replaces all fields)."""

    location_score: float = Field(description="0-10, step 0.5 — location/decoration")
    food_score: float = Field(description="0-10, step 0.5")
    service_score: float = Field(description="0-10, step 0.5")
    value_score: float = Field(description="0-10, step 0.5 — value for money, NOT price_level")
    comment: str | None = Field(default=None, max_length=1000)
    visited_at: date = Field(description="Date the reviewer says they went")

    @field_validator("location_score", "food_score", "service_score", "value_score")
    @classmethod
    def _check_score(cls, v: float) -> float:
        return _validate_score(v)
