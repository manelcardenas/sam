from datetime import date

from src.domain.entities import MealPlan, week_start_for
from src.domain.ports import MealPlanRepository


class GetPlanForWeek:
    """The week view. Returns None when nothing has been planned yet.

    None is a normal answer rather than a 404: most weeks have no plan, and the
    planner opens on an empty calendar, not on an error.
    """

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, kitchen_id: str, day: date) -> MealPlan | None:
        # Any day of the week resolves to its Saturday, so two clients disagreeing
        # about which day identifies a week can't create two plans for it (§4.4).
        return self.repository.get_plan_for_week(kitchen_id, week_start_for(day))
