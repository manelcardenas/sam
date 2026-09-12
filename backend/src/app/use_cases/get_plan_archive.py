from src.domain.entities import PlanSummary
from src.domain.ports import MealPlanRepository


class GetPlanArchive:
    """The year view (§5.3): which weeks the caller's kitchens planned.

    This is the payoff for §4.4's real dates and §4.5's saved artifact — neither
    is worth much alone, and together they are the feature. A rolling week
    overwritten every Saturday could not answer "what did we eat in August?" at
    all, and a *computed* list would answer it with today's recipes rather than
    what was actually bought.

    Plural kitchens, not one: somebody who has moved households keeps the weeks
    they planned in the old one (§8.12).
    """

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, kitchen_ids: list[str], year: int) -> list[PlanSummary]:
        return self.repository.list_year(kitchen_ids, year)
