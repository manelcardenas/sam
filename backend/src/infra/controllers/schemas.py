from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator

from src.domain.entities import Ingredient


class IngredientsInput(BaseModel):
    """Ingredients payload for create/update requests.

    Unlike the domain `Ingredients`, `servings` is required here — every
    recipe written through the API must state the headcount its amounts are
    sized for, so the UI can later scale it. See docs/adr/0001.
    """

    servings: int = Field(ge=1, description="Number of people the ingredient amounts are sized for.")
    items: list[Ingredient]

    model_config = {
        "json_schema_extra": {
            "example": {
                "servings": 4,
                "items": [{"name": "flour", "amount": 250, "unit": "g"}],
            }
        }
    }


# Request schemas for API endpoints
class CreateRecipeRequest(BaseModel):
    """Request body for creating a new recipe."""

    title: str
    instructions: str
    ingredients: IngredientsInput
    food_type: Literal["bebida", "postre", "comida", "aperitivo"]
    source_url: HttpUrl | None = None
    prep_time_minutes: int | None = None
    cook_time_minutes: int | None = None
    created_by: str | None = None


class UpdateRecipeRequest(BaseModel):
    """Request body for updating an existing recipe."""

    title: str
    instructions: str
    ingredients: IngredientsInput
    food_type: Literal["bebida", "postre", "comida", "aperitivo"]
    source_url: HttpUrl | None = None
    prep_time_minutes: int | None = None
    cook_time_minutes: int | None = None


class UpdateMeRequest(BaseModel):
    """Request body for PATCH /users/me — the user-chosen display name."""

    display_name: str = Field(min_length=1, max_length=50)


class CreateRestaurantRequest(BaseModel):
    """Request body for creating a restaurant."""

    name: str = Field(min_length=1, max_length=255)
    address: str | None = None
    price_level: int | None = Field(default=None, ge=1, le=4, description="1-4, € to €€€€")
    cuisines: list[str] = Field(default_factory=list)


class UpdateRestaurantRequest(BaseModel):
    """Request body for updating a restaurant's shared facts. Any authenticated user may call this — see ADR 0002."""

    name: str = Field(min_length=1, max_length=255)
    address: str | None = None
    price_level: int | None = Field(default=None, ge=1, le=4, description="1-4, € to €€€€")
    cuisines: list[str] = Field(default_factory=list)


def _validate_score(v: float) -> float:
    if not (0 <= v <= 10):
        raise ValueError("Score must be between 0 and 10")
    doubled = v * 2
    if abs(doubled - round(doubled)) > 1e-9:
        raise ValueError("Score must be in steps of 0.5")
    return v


class CreateReviewRequest(BaseModel):
    """Request body for submitting a review. Reviews aren't editable in v1 — delete and re-post instead."""

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
