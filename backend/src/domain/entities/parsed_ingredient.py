from pydantic import BaseModel, Field

from src.domain.entities.grocery import Aisle, GroceryItem, GrocerySource, key_for


class ProposedGroceryItem(BaseModel):
    """A vocabulary row the parser wants to create, because nothing matched.

    Kept separate from `GroceryItem` so a proposal cannot be mistaken for a
    stored row: it has no `key` (the server derives that, never the model), no
    `source` and no `confirmed_at`. The model proposes; the server decides what
    a row is called and how it is marked.
    """

    name_es: str = Field(min_length=1, max_length=255)
    name_ca: str = Field(min_length=1, max_length=255)
    name_en: str = Field(min_length=1, max_length=255)
    aisle: Aisle
    is_pantry: bool = False
    #: `g`, `ml`, or None for something counted — so the next recipe that uses
    #: it gets the same unit (ADR-0009 §5).
    default_unit: str | None = Field(default=None, max_length=50)


class ParsedLine(BaseModel):
    """One ingredient, as the parser understood it.

    `raw` is the user's own words for this line, and it is not decoration: it is
    what the review table shows when somebody asks "where did *that* come from?",
    and the only way to tell a misread line from a mistyped one.

    `grocery_key` and `proposed` are **mutually exclusive** — either this is a
    row that already exists or it is one that does not. Both set, or neither,
    means the model did not answer the question it was asked; `resolve` is where
    that is enforced rather than hoped for.
    """

    raw: str
    grocery_key: str | None = None
    proposed: ProposedGroceryItem | None = None
    amount: float | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, max_length=50)


class ParsedIngredients(BaseModel):
    """Everything a block of free text turned into.

    A list, not a dict keyed by name: `2 cebollas` and `1 cebolla tierna` are two
    lines that normalise close together, and collapsing them here would silently
    lose one before a person ever saw it.
    """

    lines: list[ParsedLine] = Field(default_factory=list)


class IngredientParserError(Exception):
    """Every provider failed, or none is configured.

    Deliberately one exception rather than one per failure mode. The caller has
    exactly one thing to do about a timeout, a rate limit, a 500 and a schema
    that came back malformed: fall back to the raw lines and let the person fix
    them by hand. Distinguishing them would offer a choice that does not exist.
    """


class ResolvedLine(BaseModel):
    """One parsed line, matched to a real vocabulary row. What the review table renders.

    Carries the whole `item` rather than a key so the client needs no second
    lookup to show the aisle, the pantry mark and the name in the reader's own
    language — and so a row created by this very call is renderable before it
    could possibly be in any cached vocabulary the client holds.
    """

    raw: str
    item: GroceryItem
    amount: float | None = None
    unit: str | None = None
    #: True when this call created the vocabulary row — the `nuevo` badge, which
    #: doubles as the typo detector: you have added eggs twenty times, so seeing
    #: it beside `huveos` is wrong in a way you spot instantly.
    is_new: bool = False
    #: The row to create **if the recipe is saved** — sent back with the
    #: ingredient, then written by `RememberGroceries` (ADR-0009 §8).
    new_item: ProposedGroceryItem | None = None
    #: Existing names close enough that this might be a misspelling of one.
    #: **A question, never a decision** — see `grocery.near_duplicates`.
    did_you_mean: list[str] = Field(default_factory=list)


class ResolvedIngredients(BaseModel):
    lines: list[ResolvedLine] = Field(default_factory=list)


def match_line(grocery_key: str | None, proposed: ProposedGroceryItem | None, known: dict[str, GroceryItem], aliases: dict[str, str]) -> tuple[GroceryItem | None, bool]:
    """The vocabulary row a model's answer means, and whether it would be brand new.

    Shared by every reader of model output, so "is this the same product?" has
    one answer whether it came from the ingredient box, a pasted recipe, a link
    or a photo.

    - A `grocery_key` the vocabulary holds is that row.
    - A key it does not hold is treated as **no match** rather than an error:
      models occasionally echo a plausible key they invented, and the proposal
      beside it is usually right.
    - A proposal whose name — in **any** of the three languages — already belongs
      to a row is that row. A second row owning the same written form would make
      `name_index` refuse to build, and every shopping-list write after it fail.
    - Otherwise the proposal becomes a new row, keyed by the server (never the
      model) and marked `source=ai`. **Not written here**: callers decide when.
    - Neither a key nor a proposal is `(None, False)`.
    """
    if grocery_key and grocery_key in known:
        return known[grocery_key], False

    if proposed is None:
        return None, False

    key = key_for(proposed.name_es)
    if key in known:
        return known[key], False

    for name in (proposed.name_es, proposed.name_ca, proposed.name_en):
        owner = aliases.get(key_for(name))
        if owner is not None:
            return known[owner], False

    return (
        GroceryItem(
            key=key,
            name_es=proposed.name_es,
            name_ca=proposed.name_ca,
            name_en=proposed.name_en,
            aisle=proposed.aisle,
            is_pantry=proposed.is_pantry,
            default_unit=proposed.default_unit,
            source=GrocerySource.AI,
        ),
        True,
    )
