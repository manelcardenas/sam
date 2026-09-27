from datetime import date

from src.app.use_cases.plan_access import plan_for_week
from src.domain.entities import MealPlan, PlanAction, permits, week_start_for
from src.domain.ports import MealPlanRepository


class CarryForward:
    """Bring everything you did not buy in earlier weeks onto this week's list.

    **The list keeps going; the week is only a date** (meal-planner-plan §8.14).
    What you did not find at the shop is still something you need, whether or not
    anybody remembered to press a button on Saturday — and the button that used
    to do this was exactly the step people skipped, which stranded the sugar in a
    week nobody opens again.

    Called by the client when it opens the current week. Idempotent: a second
    call finds nothing left to move and is a read. It does **not** create a week
    for nothing — with no pending lines it returns whatever the week already is,
    None included, so merely looking at the planner still leaves no empty rows
    in the archive (§5.3).

    Only earlier weeks feed it. A week you are planning ahead keeps its own list
    until it becomes the current one; carrying this week's leftovers into next
    week while you are still shopping this week would take them off the list you
    are holding.
    """

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, kitchen_id: str, user_id: str, day: date) -> MealPlan | None:
        week = week_start_for(day)
        if self.repository.count_pending_before(kitchen_id, week) == 0:
            return self.repository.get_plan_for_week(kitchen_id, week)

        plan = plan_for_week(self.repository, kitchen_id, week, user_id)
        # A legacy archived week cannot take lines. That only happens when the
        # current week was closed under the old flow, and its leftovers wait for
        # the next one rather than failing the page.
        if not permits(plan.status, PlanAction.EDIT_LIST):
            return plan
        self.repository.carry_forward(kitchen_id, plan.id, week)
        return self.repository.get_plan(plan.id)
