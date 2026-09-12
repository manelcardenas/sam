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
    # NULL for rows written before the kitchen existed, and once the account is
    # gone. The slot is still a slot without a name on it.
    created_by: str | None = None
    created_by_name: str | None = None


class MealPlan(BaseModel):
    """One kitchen's week."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    kitchen_id: str
    week_start: date  # always a Saturday — see `week.week_start_for`
    status: PlanStatus = PlanStatus.PLANNING
    entries: list[PlanEntry] = Field(default_factory=list)
    items: list[ShoppingListItem] = Field(default_factory=list)
    # Who started the week. Informational, like `restaurants.created_by` — it
    # gates nothing, because membership is what gates writes.
    created_by: str | None = None
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
