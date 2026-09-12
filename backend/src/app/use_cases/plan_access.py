from datetime import date

from src.domain.entities import MealPlan
from src.domain.ports import MealPlanRepository


def writable_plan(plan: MealPlan | None, kitchen_id: str) -> MealPlan:
    """Resolve a plan the caller may *change*, or raise.

    **One question, asked of the kitchen and not of the person** (§8.12). The
    old version asked "are you the owner?", which is what made one of the two
    people in a household a guest on their own shopping list. If the week belongs
    to the kitchen you are in, it is yours — there is no second, lesser tier of
    member to check for.
    """
    if plan is None:
        raise KeyError("Plan not found")
    if plan.kitchen_id != kitchen_id:
        raise PermissionError("This week belongs to another kitchen")
    return plan


def readable_plan(plan: MealPlan | None, kitchen_ids: list[str]) -> MealPlan:
    """Resolve a plan the caller may *see*, or raise.

    Wider than `writable_plan` by exactly one case: a kitchen you have left. Its
    weeks stay in your archive (§8.12) — moving out of a household does not
    delete what you ate last August — so they have to stay readable, while
    writing to them does not.
    """
    if plan is None:
        raise KeyError("Plan not found")
    if plan.kitchen_id not in kitchen_ids:
        raise PermissionError("This week isn't yours")
    return plan


def plan_for_week(repository: MealPlanRepository, kitchen_id: str, week_start: date, created_by: str) -> MealPlan:
    """The kitchen's plan for that week, created if this is the first thing in it.

    Lazy creation is deliberate: an empty plan row for every week somebody merely
    *looked* at would fill the archive (§5.3) with weeks nobody planned.

    **Two callers, and that is the point.** A week can be started from either
    end — by assigning a dish, or by putting one thing on its list. Sharing the
    helper is what makes "adding sugar starts the week" the same rule as
    "assigning lunch starts the week", rather than two implementations that can
    drift apart.
    """
    plan = repository.get_plan_for_week(kitchen_id, week_start)
    if plan is None:
        plan = repository.create_plan(kitchen_id, week_start, created_by)
    return writable_plan(plan, kitchen_id)
