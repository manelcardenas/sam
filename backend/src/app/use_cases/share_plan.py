from src.app.use_cases.plan_access import owned_plan
from src.domain.entities import MealPlan
from src.domain.ports import MealPlanRepository, UserRepository


class SharePlan:
    """Give someone read-and-tick access, by the name you know them by.

    Resolving the display name here rather than exposing a user-search endpoint
    keeps the route budget down (every path costs an API Gateway entry) and
    avoids shipping a way to enumerate accounts. The trade is real and worth
    naming: a 404 still tells the caller that a name is not in use. At six
    accounts who all know each other that is the correct trade; at a thousand it
    would not be.
    """

    def __init__(self, repository: MealPlanRepository, users: UserRepository) -> None:
        self.repository = repository
        self.users = users

    def execute(self, owner_id: str, plan_id: str, display_name: str) -> MealPlan:
        plan = owned_plan(self.repository.get_plan(plan_id), owner_id)

        guest = self.users.get_by_display_name(display_name)
        if guest is None:
            raise LookupError(f"Nobody here is called {display_name.strip()}")
        if guest.id == owner_id:
            # Sharing with yourself would create a guest row that grants nothing
            # the owner does not already have, and then render you in your own
            # guest list.
            raise ValueError("You already have this plan")

        self.repository.share_plan(plan.id, guest.id)
        refreshed = self.repository.get_plan(plan.id)
        if refreshed is None:  # pragma: no cover — the plan was read a line ago
            raise KeyError(f"Plan {plan_id} not found")
        return refreshed
