from src.app.use_cases.plan_access import writable_plan
from src.domain.entities import PlanAction, ShoppingListItem, require
from src.domain.ports import MealPlanRepository


class SetItemAmount:
    """Say how much of a line you need — "4", not "one manzana amarilla".

    The manual box could only ever add a name: a line with no number meant one
    of whatever it was, and the only way to want four was to type "4 manzanas"
    and hope the background parse read it out (meal-planner-plan §8.14). This is
    the correction that does not depend on anything guessing.

    Any line, not only hand-typed ones. A recipe's "200 g" is a starting point
    — the packet is 250 — and the person holding the list is the one who knows.
    """

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, kitchen_id: str, plan_id: str, item_id: str, amount: float) -> ShoppingListItem:
        plan = writable_plan(self.repository.get_plan(plan_id), kitchen_id)
        require(plan.status, PlanAction.EDIT_LIST)
        # Checked against *this* plan, as in `TickItem`.
        if not any(i.id == item_id for i in plan.items):
            raise KeyError(f"List item {item_id} not found")
        item = self.repository.set_item_amount(item_id, amount)
        if item is None:
            raise KeyError(f"List item {item_id} not found")
        return item
