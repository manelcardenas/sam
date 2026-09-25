from pydantic import BaseModel, Field

from src.domain.entities import Aisle


class ParseIngredientsRequest(BaseModel):
    """A block of free-typed ingredients, as the person wrote it.

    `text` is capped so a runaway paste cannot become a surprise on the bill —
    4,000 characters is far more than any household recipe and cheap to refuse.

    `servings` is context for the model, not arithmetic: it reads "para 4" better
    than it reads nothing, and **nothing scales here**. ADR-0001 scales at
    display time, so a parser that pre-divided would bake one headcount into the
    recipe for ever.
    """

    text: str = Field(min_length=1, max_length=4000)
    servings: int = Field(default=2, ge=1, le=99)


class SetAisleRequest(BaseModel):
    """Where a thing goes in the shop — for a vocabulary row, or for a list line.

    One body for both routes because it is one question. The enum is the whole
    validation: an aisle outside the eleven is a 422, never a twelfth section.
    """

    aisle: Aisle


class UpdateGroceryItemRequest(BaseModel):
    """Everything about a vocabulary row an admin can change — which is all of it but the key.

    A full replacement rather than a patch: the admin form always shows every
    field, so it always has every value, and a PUT cannot half-apply.
    """

    name_es: str = Field(min_length=1, max_length=255)
    name_ca: str = Field(min_length=1, max_length=255)
    name_en: str = Field(min_length=1, max_length=255)
    aisle: Aisle
    is_pantry: bool = False
    default_unit: str | None = Field(default=None, max_length=50)
