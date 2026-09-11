from src.app.use_cases.plan_access import owned_plan
from src.domain.entities import MealPlan
from src.domain.ports import MealPlanRepository


class UnsharePlan:
    """Take access away. Only the owner can, and the guest keeps nothing."""

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, owner_id: str, plan_id: str, guest_id: str) -> MealPlan:
        plan = owned_plan(self.repository.get_plan(plan_id), owner_id)
        self.repository.unshare_plan(plan.id, guest_id)
        refreshed = self.repository.get_plan(plan.id)
        if refreshed is None:  # pragma: no cover
            raise KeyError(f"Plan {plan_id} not found")
        return refreshed
