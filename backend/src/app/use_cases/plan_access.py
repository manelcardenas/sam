from datetime import date

from src.domain.entities import MealPlan, may_read, may_write
from src.domain.ports import MealPlanRepository


def owned_plan(plan: MealPlan | None, user_id: str) -> MealPlan:
    """Resolve a plan the caller may *change*, or raise.

    Sharing is read-and-tick (§4.3), so this stayed owner-only when guests
    arrived — the scenario is that Martina plans the week and you both shop, not
    that you edit her Wednesday.
    """
    if plan is None:
        raise KeyError("Plan not found")
    if not may_write(plan, user_id):
        raise PermissionError("Only the plan's owner can change it")
    return plan


def visible_plan(plan: MealPlan | None, user_id: str) -> MealPlan:
    """Resolve a plan the caller may *see*, or raise. Owners and guests both."""
    if plan is None:
        raise KeyError("Plan not found")
    if not may_read(plan, user_id):
        raise PermissionError("This plan isn't shared with you")
    return plan


def plan_for_week(repository: MealPlanRepository, owner_id: str, week_start: date) -> MealPlan:
    """The caller's plan for that week, created if this is the first thing in it.

    Lazy creation is deliberate: an empty plan row for every week somebody merely
    *looked* at would fill the archive (§5.3) with weeks nobody planned.

    **Two callers, and that is the point.** A week can now be started from either
    end — by assigning a dish, or by putting one thing on its list. Sharing the
    helper is what makes "adding sugar starts the week" the same rule as
    "assigning lunch starts the week", rather than two implementations that can
    drift apart.
    """
    plan = repository.get_plan_for_week(owner_id, week_start)
    if plan is None:
        plan = repository.create_plan(owner_id, week_start)
    return owned_plan(plan, owner_id)
