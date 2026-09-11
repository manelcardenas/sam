from src.app.use_cases.plan_access import owned_plan
from src.domain.entities import PlanAction, require
from src.domain.ports import MealPlanRepository


class DropEntryFromList:
    """Unpick one dish's contribution after the user confirms it (§4.5)."""

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, owner_id: str, plan_id: str, entry_id: str) -> int:
        plan = owned_plan(self.repository.get_plan(plan_id), owner_id)
        require(plan.status, PlanAction.EDIT_LIST)
        return self.repository.drop_sources_for_entry(entry_id)
