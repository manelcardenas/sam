from typing import Annotated, Literal

from pydantic import BaseModel, Field, HttpUrl

IngredientsField = Annotated[
    dict,
    Field(
        description='Ingredients payload. Example: {"servings": 4, "items": [{"name": "flour", "amount": 250, "unit": "g"}]}',
        json_schema_extra={
            "example": {
                "servings": 4,
                "items": [{"name": "flour", "amount": 250, "unit": "g"}],
            }
        },
    ),
]


# Request schemas for API endpoints
class CreateRecipeRequest(BaseModel):
    """Request body for creating a new recipe."""

    title: str
    instructions: str
    ingredients: IngredientsField
    food_type: Literal["bebida", "postre", "comida", "aperitivo"]
    source_url: HttpUrl | None = None
    prep_time_minutes: int | None = None
    cook_time_minutes: int | None = None
    created_by: str | None = None


class UpdateRecipeRequest(BaseModel):
    """Request body for updating an existing recipe."""

    title: str
    instructions: str
    ingredients: IngredientsField
    food_type: Literal["bebida", "postre", "comida", "aperitivo"]
    source_url: HttpUrl | None = None
    prep_time_minutes: int | None = None
    cook_time_minutes: int | None = None


class UpdateMeRequest(BaseModel):
    """Request body for PATCH /users/me — the user-chosen display name."""

    display_name: str = Field(min_length=1, max_length=50)
