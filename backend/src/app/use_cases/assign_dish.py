from src.app.use_cases.plan_access import plan_for_week
from src.domain.entities import MealPlan, PlanAction, PlanEntry, require, week_start_for
from src.domain.ports import MealPlanRepository


class AssignDish:
    """Put a dish in a slot, creating the week's plan if this is the first one.

    See `_plan_for_week` for why creation is lazy.
    """

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, owner_id: str, entry: PlanEntry) -> tuple[MealPlan, PlanEntry]:
        # The week is derived from the entry's own date rather than passed
        # alongside it. An earlier version took both and guarded that they
        # agreed — which was unreachable, because the only caller sent the same
        # date twice. Deriving it means an entry cannot land in a week that does
        # not contain it, instead of that being a rule someone has to enforce.
        plan = plan_for_week(self.repository, owner_id, week_start_for(entry.date))
        require(plan.status, PlanAction.EDIT_CALENDAR)
        return plan, self.repository.upsert_entry(plan.id, entry)
