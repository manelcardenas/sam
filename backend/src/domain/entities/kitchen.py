import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, Field


class KitchenMember(BaseModel):
    """One person in a kitchen, or one person invited to it.

    Carries the display name as well as the id because every surface that shows
    a member shows their name, and the id alone would mean a second lookup on a
    list the kitchen already has in hand.

    `joined_at` is None while an invitation is outstanding. That is the whole
    distinction between a member and an invite — there is no status column and
    no second table, because "invited" is exactly "a membership that has not
    been accepted yet".
    """

    user_id: str
    display_name: str | None = None
    joined_at: str | None = None
    invited_by: str | None = None


class Kitchen(BaseModel):
    """A household's shared planner.

    **Not an owner and their guests.** The scenario is two people who live
    together, and the thing that made the old share model wrong is that it had
    a direction: one person planned, the other could only tick. Everyone here
    is equally a member — there is no role column, no admin, and no `can_edit`
    flag to set. If you are in, the week and its list are yours.

    A kitchen with one member is the ordinary case, not a degenerate one: every
    account has exactly one kitchen from the moment it first opens the planner,
    and living alone is a household too.
    """

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    members: list[KitchenMember] = Field(default_factory=list)
    # Invitations this kitchen has sent and nobody has answered yet.
    pending: list[KitchenMember] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class KitchenInvite(BaseModel):
    """An invitation addressed to the caller, from someone else's kitchen.

    Shows who is already in it rather than only who sent it, because accepting
    is a *move*: you leave your own kitchen to join this one, and the honest
    question to answer before that is "whose kitchen am I joining?".
    """

    kitchen_id: str
    invited_by: str
    invited_by_name: str | None = None
    members: list[KitchenMember] = Field(default_factory=list)


class KitchenView(BaseModel):
    """What `GET /kitchen` answers: where you are, and where you have been asked.

    One response rather than two routes because the planner needs both on every
    load — the member list to render the bar, the invitations to render the
    prompt — and a second round trip for a list that is empty in the ordinary
    case is a round trip spent on nothing.
    """

    kitchen: Kitchen
    invitations: list[KitchenInvite] = Field(default_factory=list)


def is_member(kitchen: Kitchen, user_id: str) -> bool:
    """Whether this person may write to the kitchen's weeks.

    Accepted members only. Someone with an invitation outstanding is not in the
    kitchen yet — the invite is a question, and answering it is what moves them.
    """
    return any(member.user_id == user_id for member in kitchen.members)
