from datetime import date

from src.app.use_cases.plan_access import plan_for_week
from src.domain.entities import MealPlan, PlanAction, ShoppingListItem, require, week_start_for
from src.domain.ports import MealPlanRepository


class AddToWeekList:
    """Put something on a week's list without planning a single dish.

    **The list is not downstream of the calendar.** It is Wednesday, you notice
    the sugar is nearly out, and the thing you want to record has no dish, no
    slot and no recipe behind it — it is just the next shop. Requiring a dish
    first would mean inventing a meal to remember sugar.

    So this takes a *day* rather than a plan id, resolves it to that week's
    Saturday, and creates the plan if it does not exist yet — the same lazy
    creation `AssignDish` uses, which is why both go through `plan_for_week`.
    A week holding one line and no dishes is a real week: you are going to that
    shop.
    """

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, kitchen_id: str, user_id: str, day: date, items: list[ShoppingListItem]) -> MealPlan:
        plan = plan_for_week(self.repository, kitchen_id, week_start_for(day), user_id)
        require(plan.status, PlanAction.EDIT_LIST)
        self.repository.add_items(plan.id, items)
        return plan
