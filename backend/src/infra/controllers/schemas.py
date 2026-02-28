from typing import Literal

from pydantic import BaseModel


# Request schemas for API endpoints
class CreateRecipeRequest(BaseModel):
    """Request body for creating a new recipe."""

    title: str
    description: str
    ingredients: list[str]
    food_type: Literal["bebida", "postre", "comida", "aperitivo"]
    # created_by: str  # user ID of the creator


class UpdateRecipeRequest(BaseModel):
    """Request body for updating an existing recipe."""

    title: str
    description: str
    ingredients: list[str]
    food_type: Literal["bebida", "postre", "comida", "aperitivo"]
    # created_by: str  # user ID of the creator
