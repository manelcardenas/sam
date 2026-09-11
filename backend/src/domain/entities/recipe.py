import enum
import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, Field


class FoodType(str, enum.Enum):
    BEBIDA = "bebida"
    POSTRE = "postre"
    COMIDA = "comida"
    APERITIVO = "aperitivo"


class Ingredient(BaseModel):
    name: str
    amount: float | None = None
    unit: str | None = None


class Ingredients(BaseModel):
    """`servings` is the headcount the ingredient amounts are sized for."""

    servings: int | None = None
    items: list[Ingredient] = Field(default_factory=list)


class Recipe(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    instructions: str | None = None
    ingredients: Ingredients
    food_type: FoodType
    source_url: str | None = None
    prep_time_minutes: int | None = None
    cook_time_minutes: int | None = None
    created_by: str  # user ID of the creator
    created_by_name: str | None = None  # creator's display_name, resolved via join
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
