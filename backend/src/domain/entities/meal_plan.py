import enum
import uuid
from datetime import UTC, date, datetime

from pydantic import BaseModel, Field

from src.domain.entities.plan_lifecycle import PlanStatus
from src.domain.entities.shopping_list import ShoppingListItem


class Meal(enum.StrEnum):
    """Lunch and dinner only (§4.7).

    Empty breakfast rows every week are noise. This is an enum rather than two
    booleans precisely so adding one later is a migration of one value.
    """

    LUNCH = "lunch"
    DINNER = "dinner"


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
    week_start: date  # always a Saturday — see `week.week_start_for`
    status: PlanStatus = PlanStatus.PLANNING
    entries: list[PlanEntry] = Field(default_factory=list)
    items: list[ShoppingListItem] = Field(default_factory=list)
    shared_with: list[PlanGuest] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


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
