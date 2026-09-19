import enum
from datetime import UTC, datetime

from pydantic import BaseModel, Field

from src.domain.entities.shopping_list import normalise_ingredient_name


class Aisle(enum.StrEnum):
    """Where in the shop a thing is found (plan §3.3).

    **This is a route, not a taxonomy.** The test each value has to pass is
    whether you can walk the shop top to bottom in this order and never double
    back — which is why `meat_fish` is one stop (adjacent counters, one pass)
    and why `household` exists at all. An earlier draft cut `household` on the
    grounds that this is a food planner; that put detergent in `other`, which
    turned `other` into an aisle you actually shop and broke the sorting
    exactly where it was wanted.

    **Declaration order is the sort order.** Not alphabetical — see
    `meal_plan._MEAL_ORDER`, which carries the same warning after
    `"dinner" < "lunch"` rendered every day backwards. Alphabetically, `bakery`
    would open the list and `other` would land in the middle of it.
    """

    PRODUCE = "produce"
    BAKERY = "bakery"
    MEAT_FISH = "meat_fish"
    DAIRY_EGGS = "dairy_eggs"
    FROZEN = "frozen"
    CANNED = "canned"
    DRY_GOODS = "dry_goods"
    CONDIMENTS = "condiments"
    DRINKS = "drinks"
    HOUSEHOLD = "household"
    OTHER = "other"


# Built from the declaration above rather than written out again, so the two can
# never disagree. A hand-maintained copy is one insertion away from sorting a
# list by a stale order while every test still passes.
_AISLE_ORDER: dict[Aisle, int] = {aisle: index for index, aisle in enumerate(Aisle)}


def aisle_order(aisle: Aisle) -> int:
    """Sort position for `aisle` — the order you walk the shop."""
    return _AISLE_ORDER[aisle]


class GrocerySource(enum.StrEnum):
    """Who decided this row was a thing.

    Exists for one query: `source == AI and confirmed_at is None` is every guess
    nobody has vouched for. Without it a wrong row is indistinguishable from a
    curated one and there is nothing to review.
    """

    SEED = "seed"
    AI = "ai"
    HUMAN = "human"


class GroceryItem(BaseModel):
    """One buyable thing — what shelf it is on, and whether you already have it.

    **Deliberately holds no quantities.** `4 huevos` and `12 huevos` are two
    recipe lines pointing at this one row; how much is a fact about a recipe,
    what shelf is a fact about the ingredient. Keeping amounts out is what makes
    a wrong amount in one recipe unable to reach any other (plan §4.6).

    **Not called `Ingredient`** — it holds detergent, which is not an ingredient
    — and not `CatalogueItem`, because `future-roadmap.md` item 10 already uses
    "catalogue" for the supermarket product catalogue it defers.
    """

    key: str  # normalise_ingredient_name(); see `key_for`
    name_es: str
    name_ca: str
    name_en: str
    aisle: Aisle
    # Whether this is normally already in the house. **It flips the default tick
    # in the ingredient popup; it never hides a line** (plan §3.4). A spoonful of
    # oil should not reach the list, but 1 kg of sugar for a tarta should — same
    # ingredient, opposite answers — so the quantity is shown unticked and the
    # person who knows what is in the cupboard decides.
    is_pantry: bool = False
    # The unit this is normally measured in, as a hint to the parser so it writes
    # `g` and never `gramos`. NULL means counted rather than measured, which is
    # also how `20 g de huevos` becomes detectable as a mistake.
    default_unit: str | None = None
    source: GrocerySource = GrocerySource.AI
    confirmed_at: str | None = None
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())

    def name_for(self, locale: str) -> str:
        """The name in the reader's language, falling back to Spanish.

        Spanish rather than English is the fallback because the seed is written
        in it and the household speaks it; an empty column should never render a
        blank row.
        """
        return {"ca": self.name_ca, "en": self.name_en}.get(locale) or self.name_es


def key_for(name: str) -> str:
    """The vocabulary key for a written name.

    The same function the shopping list already merges on, reused rather than
    reimplemented: a row keyed differently from the way the list normalises is a
    row nothing can ever match.
    """
    return normalise_ingredient_name(name)


def name_index(items: list[GroceryItem]) -> dict[str, str]:
    """Every written form of every row → that row's key.

    **All three names, not just the Spanish one.** The key is
    `key_for(name_es)`, so an index built on keys alone only ever matches lines
    typed in Spanish — which is how `Ceba` and `Cebolla` ended up as two lines on
    one shopping list while the vocabulary held them as one row. 87% of Catalan
    names and 92% of English names normalise differently from their own key; a
    single-name lookup silently discards the entire point of §3.5.

    **Refuses to build on a collision**, rather than letting one row quietly
    shadow another. Two rows whose names collide in any language would make the
    winner depend on iteration order, and a shopping list that merges two
    unrelated ingredients sends you home without one of them. The seed has none
    today; this is what makes adding a colliding row a loud failure instead of a
    mystery next month.
    """
    index: dict[str, str] = {}
    for item in sorted(items, key=lambda i: i.key):
        for name in (item.name_es, item.name_ca, item.name_en):
            alias = key_for(name)
            owner = index.setdefault(alias, item.key)
            if owner != item.key:
                raise ValueError(f"Grocery name {name!r} maps to both {owner!r} and {item.key!r}")
    return index


def resolve_grocery_key(name: str, index: dict[str, str]) -> str | None:
    """Which vocabulary row a written line means, if any.

    Exact match on the normalised name only — **no fuzzy matching here**. §4's
    parser is where spelling is forgiven, under a model that can tell
    `spagetiis` from `espaguetis` without also deciding `queso rallado` is
    `queso parmesano`. This runs on every line of every shopping-list write,
    including hand-typed extras nobody reviewed, so a wrong answer here is one
    nobody is looking at.
    """
    return index.get(key_for(name))


# Below this, ordinary short words are one or two edits apart: `sal`/`col` is 2,
# `pan`/`pon` is 1. Suggesting those would be noise on every line.
_SHORTEST_COMPARABLE = 5
_NEAREST = 2


def _edit_distance(left: str, right: str) -> int:
    """Optimal string alignment distance — edits, with adjacent transpositions.

    Transpositions matter more than the extra code costs: the commonest typo on
    a phone keyboard is two letters swapped, and plain Levenshtein scores
    `huveos` against `huevos` as 2 rather than 1, which puts it in the same class
    as words that merely rhyme.
    """
    if left == right:
        return 0

    grid = [[0] * (len(right) + 1) for _ in range(len(left) + 1)]
    for i in range(len(left) + 1):
        grid[i][0] = i
    for j in range(len(right) + 1):
        grid[0][j] = j

    for i in range(1, len(left) + 1):
        for j in range(1, len(right) + 1):
            cost = 0 if left[i - 1] == right[j - 1] else 1
            grid[i][j] = min(grid[i - 1][j] + 1, grid[i][j - 1] + 1, grid[i - 1][j - 1] + cost)
            if i > 1 and j > 1 and left[i - 1] == right[j - 2] and left[i - 2] == right[j - 1]:
                grid[i][j] = min(grid[i][j], grid[i - 2][j - 2] + 1)

    return grid[len(left)][len(right)]


def near_duplicates(key: str, existing: list[str], limit: int = 2) -> list[str]:
    """Keys close enough to `key` that it might be a misspelling of one of them.

    **This suggests. It must never decide.** The plan originally specified a hard
    guard that refused to create a row within edit distance 2 of an existing one,
    and that is wrong in a way worth recording: `pimiento` and `pimienta` are
    distance **1** — exactly as close as `huveos` is to `huevos` — and `sal` is 2
    from `col`. A blocking rule would silently merge two real ingredients, which
    is the precise failure the parser's own instructions forbid.

    The asymmetry settles it. Wrongly merging two ingredients puts the wrong
    thing in the basket and nobody sees why; wrongly allowing a duplicate leaves
    an untidy row you can fix in one place. So the check earns its keep as a
    question in the review table — *"did you mean Huevos?"* — answered by the
    person who knows.
    """
    if len(key) < _SHORTEST_COMPARABLE:
        return []

    scored = [
        (_edit_distance(key, candidate), candidate)
        for candidate in existing
        if candidate != key and abs(len(candidate) - len(key)) <= _NEAREST and len(candidate) >= _SHORTEST_COMPARABLE
    ]
    return [candidate for distance, candidate in sorted(scored) if distance <= _NEAREST][:limit]
