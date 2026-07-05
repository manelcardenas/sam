from typing import Literal

from pydantic import BaseModel, Field, HttpUrl

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
