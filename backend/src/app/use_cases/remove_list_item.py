from src.app.use_cases.plan_access import owned_plan
from src.domain.entities import PlanAction, require
from src.domain.ports import MealPlanRepository


class RemoveListItem:
    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, owner_id: str, plan_id: str, item_id: str) -> None:
        plan = owned_plan(self.repository.get_plan(plan_id), owner_id)
        require(plan.status, PlanAction.EDIT_LIST)
        if not any(i.id == item_id for i in plan.items):
            raise KeyError(f"List item {item_id} not found")
        self.repository.delete_item(item_id)
