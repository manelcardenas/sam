from datetime import date

from src.domain.entities import MealPlan, week_start_for
from src.domain.ports import MealPlanRepository


class GetSharedPlans:
    """Weeks other people have shared with the caller.

    Separate from `GetPlanForWeek` rather than folded into it: you can have your
    own plan for a week *and* be a guest on someone else's, and a single endpoint
    returning "the plan" would have to pick one. Picking would be a guess.
    """

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, user_id: str, day: date) -> list[MealPlan]:
        return self.repository.list_shared_with(user_id, week_start_for(day))
