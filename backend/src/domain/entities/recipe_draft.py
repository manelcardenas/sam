from pydantic import BaseModel, Field

from src.domain.entities.grocery import GroceryItem
from src.domain.entities.parsed_ingredient import ProposedGroceryItem
from src.domain.entities.recipe import RecipeTag


class ReadIngredient(BaseModel):
    """One ingredient as the model read it, pointing back at the line it came from.

    `line` is an index into `ReadRecipe.ingredient_lines`. Several rows may share
    one ("sal y pimienta" is two ingredients on one line); a line no row points
    at is a line the model dropped, and `ImportRecipe` puts it back.
    """

    line: int
    raw: str
    grocery_key: str | None = None
    proposed: ProposedGroceryItem | None = None
    amount: float | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, max_length=50)
    optional: bool = False
    #: For a counted line of something bought by weight ("4 patatas"): the model's
    #: estimate of the total in grams. A suggestion the person accepts, never a value.
    grams_estimate: float | None = Field(default=None, ge=0)


class ReadRecipe(BaseModel):
    """Everything the model made of one recipe — before the server checks any of it."""

    title: str | None = None
    #: Only when the source states it ("para 4 personas"). Never guessed.
    servings: int | None = Field(default=None, ge=1, le=99)
    prep_time_minutes: int | None = Field(default=None, ge=0)
    cook_time_minutes: int | None = Field(default=None, ge=0)
    tags: list[RecipeTag] = Field(default_factory=list)
    instructions: str | None = None
    #: The source's ingredient lines, verbatim and in order. What the review's
    #: counter counts ("9 líneas → 9 ingredientes").
    ingredient_lines: list[str] = Field(default_factory=list)
    ingredients: list[ReadIngredient] = Field(default_factory=list)


class DraftIngredient(BaseModel):
    """One row of the review screen.

    Exactly one of `item` and `new_item` is set when the line was understood:
    `item` is a product the vocabulary already has, `new_item` one it would gain
    **if the recipe is saved** (ADR-0009 §8). Neither, when the model could not
    make sense of the line — the row then holds the line's own words as its
    name, so nothing typed is ever lost.
    """

    line: int
    source_line: str
    name: str
    amount: float | None = None
    unit: str | None = None
    optional: bool = False
    item: GroceryItem | None = None
    new_item: ProposedGroceryItem | None = None
    #: Existing names close to a new one — "¿querías decir Huevos?". A question, never a decision.
    did_you_mean: list[str] = Field(default_factory=list)
    #: "≈ 800 g" for "4 patatas", when the product is bought by weight.
    grams_suggestion: float | None = None
    #: True when the model returned nothing for this line and the server restored it.
    restored: bool = False


class RecipeDraft(BaseModel):
    """A recipe read from text, a link or a photo, waiting for a person to review and save it.

    **Nothing in here has been written anywhere.** Not the recipe, and not the
    products in `new_item` — both happen on "Guardar".
    """

    title: str | None = None
    servings: int | None = None
    #: The number came from the source, so the form can say "leído del texto".
    servings_from_source: bool = False
    prep_time_minutes: int | None = None
    cook_time_minutes: int | None = None
    tags: list[RecipeTag] = Field(default_factory=list)
    instructions: str | None = None
    source_url: str | None = None
    ingredient_lines: list[str] = Field(default_factory=list)
    ingredients: list[DraftIngredient] = Field(default_factory=list)


class RecipePage(BaseModel):
    """What a recipe web page offered, before any model read it.

    `structured` is the page's own `schema.org/Recipe`, when it has one — most
    recipe sites do, for Google — and then its ingredient lines and method are
    taken as written, with no model guessing where they start. `text` is the
    page's visible text, for the pages that have no such thing.
    """

    url: str
    title: str | None = None
    servings: int | None = None
    prep_time_minutes: int | None = None
    cook_time_minutes: int | None = None
    ingredient_lines: list[str] = Field(default_factory=list)
    instructions: str | None = None
    text: str = ""

    @property
    def structured(self) -> bool:
        return bool(self.ingredient_lines)


class RecipeReaderError(Exception):
    """The model could not be reached, or answered something unusable. The person can still type the recipe."""


class RecipePageError(Exception):
    """The link could not be read: refused (not https, a private address), unreachable, too big, or not a page."""
