"""The meal planner's domain: a week of slots, and the list it accretes.

See docs/plans/meal-planner-plan.md. The two decisions that shape everything
here, both from §4:

- **The list is a saved artifact, not a computed view** (§4.5). You want to keep
  old lists, and a computed list cannot be old — recompute August's in November
  and it reflects today's dishes rather than what you actually bought. So list
  lines are rows, and they record what was decided rather than deriving it.
- **Names are snapshotted** alongside the foreign keys they duplicate (§8.3a).
  Deleting a recipe must not rewrite history, so `dish_name` is stored on both
  the entry and the list source and `recipe_id` is nullable.
"""

import enum
import unicodedata
import uuid
from datetime import UTC, date, datetime

from pydantic import BaseModel, Field


class Meal(enum.StrEnum):
    """Lunch and dinner only (§4.7).

    Empty breakfast rows every week are noise. This is an enum rather than two
    booleans precisely so adding one later is a migration of one value.
    """

    LUNCH = "lunch"
    DINNER = "dinner"


class PlanStatus(enum.StrEnum):
    """The plan's lifecycle (§8.2).

    Three states, not four: `archived` is what `list_closed` is *called* in the
    UI, and nothing could distinguish them, so it is not a state here.
    """

    PLANNING = "planning"
    CALENDAR_CLOSED = "calendar_closed"
    LIST_CLOSED = "list_closed"


class PlanAction(enum.StrEnum):
    """What someone is trying to do, for the permission table below."""

    EDIT_CALENDAR = "edit_calendar"
    EDIT_LIST = "edit_list"
    TICK = "tick"


# What each state permits.
#
# `CALENDAR_CLOSED` is the *shopping* state, which is why it still allows list
# edits and ticking: §2's flow closes the calendar before you leave the house,
# and the last additions — fruit, yoghurt, the things no dish implies — happen on
# the way out. `LIST_CLOSED` is what you do when the shopping is home.
_PERMITTED: dict[PlanStatus, frozenset[PlanAction]] = {
    PlanStatus.PLANNING: frozenset({PlanAction.EDIT_CALENDAR, PlanAction.EDIT_LIST, PlanAction.TICK}),
    PlanStatus.CALENDAR_CLOSED: frozenset({PlanAction.EDIT_LIST, PlanAction.TICK}),
    PlanStatus.LIST_CLOSED: frozenset(),
}

# One-way, one step at a time (§5.2 defers reopening). Expressed as a map rather
# than as `if` branches so "what comes next" has exactly one answer and the
# terminal state is visibly terminal.
_NEXT: dict[PlanStatus, PlanStatus | None] = {
    PlanStatus.PLANNING: PlanStatus.CALENDAR_CLOSED,
    PlanStatus.CALENDAR_CLOSED: PlanStatus.LIST_CLOSED,
    PlanStatus.LIST_CLOSED: None,
}


class PlanStateError(Exception):
    """A write the plan's current state forbids.

    Deliberately distinct from "not yours": the controller maps this to 409 and
    ownership failures to 403, because a client that cannot tell them apart tells
    the user they lack permission when in fact they closed the week an hour ago.
    """


def permits(status: PlanStatus, action: PlanAction) -> bool:
    return action in _PERMITTED[status]


def require(status: PlanStatus, action: PlanAction) -> None:
    """Guard for use cases. Raises rather than returning a bool, so a caller
    cannot forget to check the result."""
    if not permits(status, action):
        raise PlanStateError(f"Cannot {action.value} while the plan is {status.value}")


def next_status(status: PlanStatus) -> PlanStatus:
    """The one transition available from here. Raises at the terminal state."""
    following = _NEXT[status]
    if following is None:
        raise PlanStateError(f"A plan that is {status.value} has nowhere left to go")
    return following


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


def merge_key(name: str, unit: str | None) -> tuple[str, str]:
    """`(normalised name, unit)` with the unit's absence made explicit.

    The empty string rather than None is not cosmetic: Postgres treats NULLs as
    distinct in a unique constraint, so a key holding None would let two `huevos`
    rows exist side by side — and most household ingredients have no unit, which
    makes that the common case rather than the edge one (§8.3b). The SQL index
    uses `COALESCE(unit, '')` for exactly this reason and this mirrors it.
    """
    return normalise_ingredient_name(name), (unit or "").strip().lower()


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
    unit: str | None = None
    total_amount: float | None = None
    is_checked: bool = False
    is_manual: bool = False  # hand-added extra rather than implied by a dish
    sources: list[ListItemSource] = Field(default_factory=list)


class PlanEntry(BaseModel):
    """One dish in one slot, for a stated number of people."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    date: date
    meal: Meal
    recipe_id: str | None = None  # NULL once the recipe is deleted; the name survives
    dish_name: str
    servings: int = Field(ge=1)


class PlanGuest(BaseModel):
    """Someone the plan is shared with — read and tick only (§4.3).

    Carries the display name as well as the id because every surface that shows
    a guest shows their name, and the id alone would mean a second lookup on a
    list the plan already has in hand.
    """

    user_id: str
    display_name: str | None = None


class MealPlan(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    owner_id: str
    owner_name: str | None = None
    week_start: date  # always a Saturday — see `week_start_for`
    status: PlanStatus = PlanStatus.PLANNING
    entries: list[PlanEntry] = Field(default_factory=list)
    items: list[ShoppingListItem] = Field(default_factory=list)
    shared_with: list[PlanGuest] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


# Lunch before dinner. **Not alphabetical** — `"dinner" < "lunch"`, so sorting on
# the enum's value renders every day backwards, with dinner above lunch.
_MEAL_ORDER: dict[Meal, int] = {Meal.LUNCH: 0, Meal.DINNER: 1}


def sort_entries(entries: list[PlanEntry]) -> list[PlanEntry]:
    """Chronological: by day, then lunch before dinner.

    Lives here rather than in each adapter because both have to agree, and a
    fake that orders differently from the database is a test suite that passes
    while production renders the week wrong.
    """
    return sorted(entries, key=lambda e: (e.date, _MEAL_ORDER[e.meal]))


def sort_items(items: list[ShoppingListItem]) -> list[ShoppingListItem]:
    """By normalised name, so the list reads stably however lines were added."""
    return sorted(items, key=lambda i: i.normalised_name)


class PlanSummary(BaseModel):
    """One week in the archive (§5.3) — enough to list it, not enough to render it.

    **Deliberately not a `MealPlan`.** A year holds up to 53 of them, and a full
    plan carries every entry, every list line and every line's sources. The year
    view shows *which* weeks were planned and how full they were; sending the
    contents of all of them to draw that would be a few hundred kilobytes to
    render a grid of dots.
    """

    id: str
    week_start: date
    status: PlanStatus
    owner_id: str
    owner_name: str | None = None
    # False when the week was shared with you rather than planned by you — the
    # one distinction §5.3 asks the year view to draw.
    is_mine: bool
    entry_count: int = 0
    item_count: int = 0
    checked_count: int = 0


def may_read(plan: MealPlan, user_id: str) -> bool:
    """Owners and guests can see a plan. Nobody else can.

    Kept next to `may_write` so the asymmetry between them is visible in one
    place: the *only* thing a guest may do beyond reading is tick, and that is
    enforced by which use cases call which of these.
    """
    return plan.owner_id == user_id or any(guest.user_id == user_id for guest in plan.shared_with)


def may_write(plan: MealPlan, user_id: str) -> bool:
    """Only the owner changes a plan — v1 sharing is read-and-tick (§4.3)."""
    return plan.owner_id == user_id


# The week runs Saturday → Friday: you plan on Saturday and shop on Sunday, so
# the planning day has to be the *first* day of the week you are planning, not
# the last day of the one ending. `date.weekday()` counts Monday as 0, so
# Saturday is 5.
#
# Seven days rather than "Saturday to Saturday" inclusive: consecutive weeks have
# to tile without overlapping, or one real dinner belongs to two plans at once
# and `uq_plan_entries_slot` cannot stop it being assigned twice.
WEEK_STARTS_ON = 5  # Saturday
DAYS_IN_WEEK = 7


def week_start_for(day: date) -> date:
    """The Saturday on or before `day`.

    Entries are keyed to real dates (§4.4) — the grid is how a week renders, not
    what it is. Normalising the plan's own key is what stops the same week
    existing twice because two clients disagreed about which day to send.
    """
    return day.fromordinal(day.toordinal() - (day.weekday() - WEEK_STARTS_ON) % DAYS_IN_WEEK)
