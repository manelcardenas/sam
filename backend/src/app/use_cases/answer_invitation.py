from src.domain.entities import KitchenView
from src.domain.ports import KitchenRepository


class AnswerInvitation:
    """Accept or decline an invitation addressed to the caller.

    Accepting is a **move**, and the repository does both halves in one step:
    you leave the kitchen you are in and join the one that asked. Two calls
    would leave a window in which the one-active-kitchen rule decides the
    outcome by rejecting the second half.

    What you leave behind stays yours to read. The weeks you planned alone keep
    their old kitchen and keep appearing in your archive (§8.12) — the household
    changed, the record did not.
    """

    def __init__(self, kitchens: KitchenRepository) -> None:
        self.kitchens = kitchens

    def execute(self, user_id: str, kitchen_id: str, accept: bool) -> KitchenView:
        if accept:
            self.kitchens.accept_invitation(kitchen_id, user_id)
        else:
            self.kitchens.discard_invitation(kitchen_id, user_id)

        kitchen = self.kitchens.active_kitchen_for(user_id)
        if kitchen is None:  # pragma: no cover — the caller had one to be invited from
            raise KeyError("No kitchen")
        return KitchenView(kitchen=kitchen, invitations=self.kitchens.invitations_for(user_id))
