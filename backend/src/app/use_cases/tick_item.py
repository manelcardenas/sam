from src.app.use_cases.plan_access import writable_plan
from src.domain.entities import PlanAction, ShoppingListItem, require
from src.domain.ports import MealPlanRepository


class TickItem:
    """Check or uncheck a line.

    Allowed on any week that is not archived, and to **anyone in the
    kitchen**, which used to be the one permission sharing granted and is now
    simply what membership means (§8.12).
    """

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, kitchen_id: str, plan_id: str, item_id: str, is_checked: bool) -> ShoppingListItem:
        plan = writable_plan(self.repository.get_plan(plan_id), kitchen_id)
        require(plan.status, PlanAction.TICK)
        if not any(i.id == item_id for i in plan.items):
            # Checked against *this* plan, so an id from another kitchen's list
            # can't be ticked by guessing it.
            raise KeyError(f"List item {item_id} not found")
        item = self.repository.set_item_checked(item_id, is_checked)
        if item is None:
            raise KeyError(f"List item {item_id} not found")
        return item
