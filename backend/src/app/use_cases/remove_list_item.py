from src.app.use_cases.plan_access import writable_plan
from src.domain.entities import PlanAction, require
from src.domain.ports import MealPlanRepository


class RemoveListItem:
    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, kitchen_id: str, plan_id: str, item_id: str) -> None:
        plan = writable_plan(self.repository.get_plan(plan_id), kitchen_id)
        require(plan.status, PlanAction.EDIT_LIST)
        if not any(i.id == item_id for i in plan.items):
            raise KeyError(f"List item {item_id} not found")
        self.repository.delete_item(item_id)
