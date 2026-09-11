from src.app.use_cases.plan_access import owned_plan
from src.domain.entities import PlanAction, ShoppingListItem, require
from src.domain.ports import MealPlanRepository


class AddToList:
    """Merge confirmed ingredient lines into the list.

    The amounts arrive already scaled to the slot's headcount. That is not the
    server being lazy: ADR 0001 scales by servings for *display*, and this list
    records what the user actually confirmed in the popup — including anything
    they unticked. Recomputing it here would quietly overrule them.
    """

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, owner_id: str, plan_id: str, items: list[ShoppingListItem]) -> list[ShoppingListItem]:
        plan = owned_plan(self.repository.get_plan(plan_id), owner_id)
        require(plan.status, PlanAction.EDIT_LIST)
        return self.repository.add_items(plan.id, items)
