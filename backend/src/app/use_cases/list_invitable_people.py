from src.app.use_cases.kitchen_access import current_kitchen
from src.domain.entities import Person
from src.domain.ports import KitchenRepository, UserRepository


class ListInvitablePeople:
    """The people you could ask into your kitchen.

    **Why this exists at all.** Inviting used to mean typing somebody's display
    name exactly, and a typo came back as "nobody here is called that" — the app
    knew the answer and made you guess it anyway. A list you pick from cannot be
    got wrong, so the failure mode disappears rather than being explained better.

    **Why the filtering is here and not in the browser.** "Invitable" is a rule
    about the kitchen — not yourself, not somebody already in it, not somebody
    already asked — and the kitchen is what this layer knows. Handing the client
    the whole directory and a copy of the rule would give two places to be wrong.

    This does enumerate accounts, which the earlier by-name lookup deliberately
    did not. That trade is now made on purpose: at six accounts who all live
    together the leak is "these people also use SAM", which they know, and the
    thing bought with it is that nobody has to spell a housemate's name.
    """

    def __init__(self, kitchens: KitchenRepository, users: UserRepository) -> None:
        self.kitchens = kitchens
        self.users = users

    def execute(self, user_id: str) -> list[Person]:
        kitchen = current_kitchen(self.kitchens, user_id)
        # The caller is always in `members`, so this excludes them too.
        here = {member.user_id for member in kitchen.members} | {member.user_id for member in kitchen.pending}
        return [person for person in self.users.list_people() if person.id not in here]
