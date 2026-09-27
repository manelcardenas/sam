import unicodedata
import uuid
from datetime import date

from pydantic import BaseModel, Field


def normalise_ingredient_name(name: str) -> str:
    """The shopping list's merge key (§8.3c).

    Lowercase, collapse whitespace, strip diacritics. **That is all** — no plural
    stemming, for the same reason §3 refuses unit conversion: merging
    `cebolla`/`cebollas` is pleasant right up until `pimiento`/`pimienta` merge
    too, and a wrong merge means coming home without an ingredient.

    Stripping diacritics is safe in a way stemming is not: it only ever folds two
    spellings of one word together, and phone keyboards make `platano`/`plátano`
    a real pair rather than a hypothetical one.
    """
    decomposed = unicodedata.normalize("NFD", name.strip().lower())
    without_marks = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return " ".join(without_marks.split())


def merge_key(name: str, unit: str | None, grocery_key: str | None = None) -> tuple[str, str]:
    """`(identity, unit)` — what makes two lines the same line.

    **The identity is the vocabulary key when there is one**, and the normalised
    name otherwise (ingredient-capture-plan §6.1). That fallback is what lets a
    hand-typed `bolsas de basura` behave exactly as it did before this existed,
    and it is why no shopping-list row ever needed migrating: a line whose name
    already normalises to its own key coalesces to the same string either way.

    Without the key, the three names per `grocery_items` row are decorative —
    `huevos` and `eggs` are one thing in the vocabulary and two lines on the
    list, which is the exact failure §3.5 exists to prevent.

    The empty string rather than None for the unit is not cosmetic: Postgres
    treats NULLs as distinct in a unique constraint, so a key holding None would
    let two `huevos` rows exist side by side — and most household ingredients
    have no unit, which makes that the common case rather than the edge one
    (§8.3b). The SQL index uses `COALESCE(unit, '')` for exactly this reason and
    this mirrors it.
    """
    return (grocery_key or normalise_ingredient_name(name)), (unit or "").strip().lower()


class ListItemSource(BaseModel):
    """Why a line is on the list, and how much of it this dish accounts for.

    `dish_name` is a snapshot rather than a join: the answer to *"why is there
    fennel on this list?"* has to survive deleting the recipe that put it there.
    """

    entry_id: str | None = None
    dish_name: str
    amount: float | None = None


class ShoppingListItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    display_name: str  # as first typed — the list reads in the user's own words
    normalised_name: str
    # The vocabulary row this line means, when one could be found. NULL is the
    # normal state for anything hand-typed that the vocabulary does not know, and
    # it costs only the aisle — the line still merges, on its name.
    grocery_key: str | None = None
    unit: str | None = None
    total_amount: float | None = None
    is_checked: bool = False
    is_manual: bool = False  # hand-added extra rather than implied by a dish
    # The week this line was first meant for, when it was not bought there and
    # followed you here (`CarryForward`). NULL for a line that belongs to this
    # week. A date rather than a flag so the list can say *how long* something
    # has been pending — a line three weeks old is one to buy or to let go.
    pending_since: date | None = None
    sources: list[ListItemSource] = Field(default_factory=list)
    created_by: str | None = None
    created_by_name: str | None = None


def sort_items(items: list[ShoppingListItem]) -> list[ShoppingListItem]:
    """By normalised name, so the list reads stably however lines were added."""
    return sorted(items, key=lambda i: i.normalised_name)
