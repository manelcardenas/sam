from src.app.use_cases.plan_access import owned_plan
from src.domain.entities import MealPlan, PlanAction, require
from src.domain.ports import MealPlanRepository


class RemoveDish:
    """Clear a slot. Its shopping-list contribution is left alone.

    §4.5's drift rule: the list is a saved artifact, and one that rewrites itself
    while you are holding it in the shop is worse than one that asks. Unpicking
    the ingredients is a second, explicit call the client makes after the user
    says yes — see `DropEntryFromList`.
    """

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, owner_id: str, plan_id: str, entry_id: str) -> MealPlan:
        plan = owned_plan(self.repository.get_plan(plan_id), owner_id)
        require(plan.status, PlanAction.EDIT_CALENDAR)
        if not any(e.id == entry_id for e in plan.entries):
            raise KeyError(f"Plan entry {entry_id} not found")
        self.repository.delete_entry(entry_id)
        return plan
