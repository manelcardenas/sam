from src.app.use_cases.plan_access import visible_plan
from src.domain.entities import PlanAction, ShoppingListItem, require
from src.domain.ports import MealPlanRepository


class TickItem:
    """Check or uncheck a line.

    Allowed in every state a plan is still open in, because `calendar_closed` is
    the state you are actually shopping in — and allowed to **guests as well as
    the owner**, which is the one permission sharing grants (§4.3).
    """

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, user_id: str, plan_id: str, item_id: str, is_checked: bool) -> ShoppingListItem:
        # `_visible`, not `_owned` — this is the single write sharing grants, and
        # it is the whole point of sharing: you are in the shop holding someone
        # else's list.
        plan = visible_plan(self.repository.get_plan(plan_id), user_id)
        require(plan.status, PlanAction.TICK)
        if not any(i.id == item_id for i in plan.items):
            # Checked against *this* plan, so an id from someone else's list
            # can't be ticked by guessing it.
            raise KeyError(f"List item {item_id} not found")
        item = self.repository.set_item_checked(item_id, is_checked)
        if item is None:
            raise KeyError(f"List item {item_id} not found")
        return item
