from src.app.use_cases.kitchen_access import current_kitchen
from src.domain.entities import KitchenView
from src.domain.ports import KitchenRepository


class GetKitchen:
    """Where the caller lives, and where they have been asked to.

    One response rather than two routes because the planner needs both on every
    load — the member list to render the bar, the invitations to render the
    prompt — and a second round trip for a list that is empty in the ordinary
    case is a round trip spent on nothing.
    """

    def __init__(self, kitchens: KitchenRepository) -> None:
        self.kitchens = kitchens

    def execute(self, user_id: str) -> KitchenView:
        return KitchenView(
            kitchen=current_kitchen(self.kitchens, user_id),
            invitations=self.kitchens.invitations_for(user_id),
        )
