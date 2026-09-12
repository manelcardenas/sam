from src.app.use_cases.kitchen_access import current_kitchen
from src.domain.entities import Kitchen, is_member
from src.domain.ports import KitchenRepository, UserRepository


class InviteToKitchen:
    """Ask someone to share your planner, by the name you know them by.

    **An invitation rather than an addition**, because joining is a *move*: the
    other person leaves their own kitchen to come here, and their weeks stop
    being theirs alone. Something with that consequence cannot be done to
    somebody by typing their name.

    **By id, not by name.** The caller picks from `ListInvitablePeople`, so it
    already holds the id and cannot mistype it — which is the point: the old
    by-name form turned a misremembered spelling into a 404 the user had to
    guess their way out of. The checks below survive that change because they
    now guard a race (somebody accepted, or was invited, between the list being
    drawn and the row being tapped) rather than a typo.
    """

    def __init__(self, kitchens: KitchenRepository, users: UserRepository) -> None:
        self.kitchens = kitchens
        self.users = users

    def execute(self, user_id: str, invitee_id: str) -> Kitchen:
        kitchen = current_kitchen(self.kitchens, user_id)

        invitee = self.users.get_by_id(invitee_id)
        if invitee is None:
            raise LookupError("That person is no longer in SAM")
        if invitee.id == user_id:
            raise ValueError("You're already in this kitchen")
        if is_member(kitchen, invitee.id):
            # Distinct from the double-tap case the repository absorbs: that one
            # is a second invitation to the same person, which changes nothing.
            # This one is an invitation to somebody already here, which would
            # render as a pending row next to their own member row.
            raise ValueError(f"{invitee.display_name} is already in this kitchen")

        self.kitchens.invite(kitchen.id, invitee.id, user_id)
        refreshed = self.kitchens.get_kitchen(kitchen.id)
        if refreshed is None:  # pragma: no cover — read a line ago
            raise KeyError(f"Kitchen {kitchen.id} not found")
        return refreshed
