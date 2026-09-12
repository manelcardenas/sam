from src.app.use_cases.plan_access import readable_plan
from src.domain.entities import MealPlan
from src.domain.ports import MealPlanRepository


class GetPlan:
    """One week by id, for the archive's deep links.

    Separate from `GetPlanForWeek` because the two answer different questions.
    By *date* means "the week my kitchen is planning", which is what the planner
    opens on. By *id* means "this exact week", which is what an archive row links
    to — and those can differ for anyone who has moved between kitchens, where
    last August belongs to a household they have since left (§8.12).
    """

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, kitchen_ids: list[str], plan_id: str) -> MealPlan:
        return readable_plan(self.repository.get_plan(plan_id), kitchen_ids)
