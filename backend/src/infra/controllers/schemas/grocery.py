from pydantic import BaseModel, Field


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
