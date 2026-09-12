from src.app.use_cases.kitchen_access import current_kitchen
from src.domain.entities import Kitchen, is_member
from src.domain.ports import KitchenRepository


class RemoveFromKitchen:
    """Leave the kitchen, or withdraw an invitation you sent.

    **Nobody can remove anybody else.** That is the one rule that keeps
    membership symmetric: with no owner and no admin, an eject button would have
    to invent one, and "we live together" is not a relationship that should have
    a person who can end it unilaterally from inside the app.

    Withdrawing an invitation is the single exception, and it is not really one:
    a pending invitee is not in the kitchen yet, and undoing a mistyped name is
    undoing your own action rather than acting on somebody else.

    Leaving puts you in a fresh kitchen of your own, immediately — there is no
    state in which somebody has no household to plan in.
    """

    def __init__(self, kitchens: KitchenRepository) -> None:
        self.kitchens = kitchens

    def execute(self, user_id: str, target_id: str) -> Kitchen:
        kitchen = current_kitchen(self.kitchens, user_id)

        if target_id == user_id:
            if len(kitchen.members) == 1:
                # Leaving a kitchen you are alone in would create a second empty
                # one and move nothing. Refused rather than absorbed, because the
                # button should not be on screen and a silent success would hide
                # that it is.
                raise ValueError("You're the only one here")
            self.kitchens.leave(kitchen.id, user_id)
            return current_kitchen(self.kitchens, user_id)

        if is_member(kitchen, target_id):
            raise PermissionError("Nobody can be removed from a kitchen except by themselves")

        self.kitchens.discard_invitation(kitchen.id, target_id)
        refreshed = self.kitchens.get_kitchen(kitchen.id)
        if refreshed is None:  # pragma: no cover — read a line ago
            raise KeyError(f"Kitchen {kitchen.id} not found")
        return refreshed
