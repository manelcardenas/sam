from pydantic import BaseModel, Field


class InviteRequest(BaseModel):
    """Ask someone into your kitchen.

    An id rather than the display name this used to take. The caller chooses
    from `GET /kitchen/people`, so it is holding the id already, and the name
    form only ever existed because there was nothing to choose from — at the
    cost of turning a misremembered spelling into a 404.
    """

    user_id: str = Field(min_length=1, max_length=128)


class AnswerInvitationRequest(BaseModel):
    """Yes or no to an invitation.

    One field rather than two routes because accepting and declining are the same
    decision, and a `DELETE` for "no" would sit next to a `DELETE` that means
    "withdraw the one I sent" — two different acts spelled identically.
    """

    accept: bool = Field(description="True joins the kitchen and leaves your own; false discards the invitation")
