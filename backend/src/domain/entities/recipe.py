import enum
import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, Field


class FoodType(enum.StrEnum):
    """What kind of thing this is, as a person would say it.

    `GUARNICION` was added for the planner (ingredient-capture-plan §5.3): rice,
    potatoes, a green salad — things you plate *alongside* something else. It is
    a category here rather than a separate entity or a second collection,
    because a `postre` is equally "not a meal, a component of one" and the schema
    accepted that framing four values ago. A guarnición graduates into an
    ordinary recipe the moment somebody writes the method down, exactly as
    ADR-0007 describes.
    """

    BEBIDA = "bebida"
    POSTRE = "postre"
    COMIDA = "comida"
    APERITIVO = "aperitivo"
    GUARNICION = "guarnicion"


class Ingredient(BaseModel):
    name: str
    amount: float | None = None
    unit: str | None = None


class Ingredients(BaseModel):
    """`servings` is the headcount the ingredient amounts are sized for."""

    servings: int | None = None
    items: list[Ingredient] = Field(default_factory=list)


class RecipeRef(BaseModel):
    """Enough of a recipe to name it and link to it — for lists that point at recipes."""

    id: str
    title: str


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
