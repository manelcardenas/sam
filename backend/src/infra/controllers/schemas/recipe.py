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


def _blank_to_none(v: str | None) -> str | None:
    """A method left empty is no method at all, and no method is `NULL`.

    Without this the API has two spellings of the same state — `""` and `null` —
    and every reader has to know both. Normalising at the edge means "does this
    recipe have a method?" is a single `IS NULL` test everywhere behind it.
    """
    if v is None:
        return None
    return v.strip() or None


class CreateRecipeRequest(BaseModel):
    """Request body for creating a new recipe.

    `instructions` is optional: a recipe you already know how to make needs only
    its ingredients to be plannable and shoppable (docs/adr/0007). Blank input is
    normalised to NULL so `""` and `"   "` never masquerade as a written method.
    """

    title: str
    instructions: str | None = Field(default=None, description="Optional — omit it for something you already know how to make")
    ingredients: IngredientsInput
    food_type: Literal["bebida", "postre", "comida", "aperitivo"]
    source_url: HttpUrl | None = None
    prep_time_minutes: int | None = None
    cook_time_minutes: int | None = None
    created_by: str | None = None

    _normalise_instructions = field_validator("instructions")(_blank_to_none)


class UpdateRecipeRequest(BaseModel):
    """Request body for updating an existing recipe.

    `instructions` can be written in or cleared out at any time; neither is
    special-cased, because nothing downstream branches on whether it is set.
    """

    title: str
    instructions: str | None = Field(default=None, description="Optional — empty or omitted clears the method")
    ingredients: IngredientsInput
    food_type: Literal["bebida", "postre", "comida", "aperitivo"]
    source_url: HttpUrl | None = None
    prep_time_minutes: int | None = None
    cook_time_minutes: int | None = None

    _normalise_instructions = field_validator("instructions")(_blank_to_none)
