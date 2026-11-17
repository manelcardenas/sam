from abc import ABC, abstractmethod

from pydantic import BaseModel

from src.domain.entities import GroceryItem, ReadRecipe, RecipePage


class RecipeSource(BaseModel):
    """What the person handed over: pasted text, a page already fetched, or a photo.

    Exactly one of `text` and `image` is the thing to read. `known_lines` is set
    when the ingredient lines are already known — a page's own `schema.org`
    list — and then the model structures those lines rather than finding them.
    """

    text: str | None = None
    #: A `data:image/...;base64,` URL. Read and discarded; never stored.
    image: str | None = None
    known_lines: list[str] | None = None


class RecipeReader(ABC):
    """Read a whole recipe — title, servings, times, tags, method and ingredients — in one call (ADR-0009 §8).

    One call rather than one per field, for the reason `IngredientParser` gives:
    context disambiguates ("tomate" in a list with pasta is the tinned kind), and
    the vocabulary prefix is paid for once.

    `usage` is how the kitchen's own recipes already write each product —
    `{"patata": {"g": 6}}` — so a new recipe uses the same unit (ADR-0009 §5).

    Implementations raise `RecipeReaderError` and nothing else.
    """

    @abstractmethod
    def read(self, source: RecipeSource, vocabulary: list[GroceryItem], usage: dict[str, dict[str, int]]) -> ReadRecipe:
        pass


class RecipePageFetcher(ABC):
    """Fetch a recipe page from the open web, safely, and say what it offers.

    Raises `RecipePageError` for anything it will not or cannot read: a link that
    is not https, one that resolves to a private address, one that is too slow
    or too big, or something that is not a web page.
    """

    @abstractmethod
    def fetch(self, url: str) -> RecipePage:
        pass
