from typing import Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator, model_validator

from src.domain.entities import Ingredient, ProposedGroceryItem, RecipeTag, Visibility


class IngredientInput(Ingredient):
    """An ingredient as the form sends it: the stored fields, plus what it may add to the vocabulary.

    `new_item` is the model's proposal for a product the vocabulary does not have
    yet, carried through the review untouched. It is **not stored on the recipe**
    — saving turns it into a vocabulary row (`RememberGroceries`) and the recipe
    keeps only the name, as every ingredient always has.
    """

    new_item: ProposedGroceryItem | None = None


class IngredientsInput(BaseModel):
    """Ingredients payload for create/update requests.

    Unlike the domain `Ingredients`, `servings` is required here — every
    recipe written through the API must state the headcount its amounts are
    sized for, so the UI can later scale it. See docs/adr/0001.
    """

    servings: int = Field(ge=1, description="Number of people the ingredient amounts are sized for.")
    items: list[IngredientInput]

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
    food_type: Literal["bebida", "postre", "comida", "aperitivo", "guarnicion"]
    source_url: HttpUrl | None = None
    prep_time_minutes: int | None = Field(default=None, ge=0, le=10_000)
    cook_time_minutes: int | None = Field(default=None, ge=0, le=10_000)
    tags: list[RecipeTag] = Field(default_factory=list)
    visibility: Visibility = Visibility.PUBLIC
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
    food_type: Literal["bebida", "postre", "comida", "aperitivo", "guarnicion"]
    source_url: HttpUrl | None = None
    prep_time_minutes: int | None = Field(default=None, ge=0, le=10_000)
    cook_time_minutes: int | None = Field(default=None, ge=0, le=10_000)
    tags: list[RecipeTag] = Field(default_factory=list)
    visibility: Visibility = Visibility.PUBLIC

    _normalise_instructions = field_validator("instructions")(_blank_to_none)


class ImportRecipeRequest(BaseModel):
    """One recipe to read: pasted text, a link, or a photo — exactly one of them.

    The caps are what a paid call is allowed to cost. 20,000 characters is a long
    recipe with its life story; a photo is resized on the phone to ~1600 px
    before it is sent, so 4 MB of base64 is far more than one needs, and stays
    under the 4.5 MB a Vercel function accepts.
    """

    text: str | None = Field(default=None, min_length=1, max_length=20_000)
    url: str | None = Field(default=None, min_length=1, max_length=2048)
    image: str | None = Field(default=None, max_length=4_000_000, pattern=r"^data:image/(jpeg|png|webp|gif);base64,")

    @model_validator(mode="after")
    def _exactly_one(self) -> "ImportRecipeRequest":
        given = [value for value in (self.text, self.url, self.image) if value]
        if len(given) != 1:
            raise ValueError("Send exactly one of text, url or image")
        return self
