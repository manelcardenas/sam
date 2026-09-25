from pydantic import BaseModel, Field

from src.domain.entities import User


class UpdateMeRequest(BaseModel):
    """Request body for PATCH /users/me — the user-chosen display name."""

    display_name: str = Field(min_length=1, max_length=50)


class MeResponse(User):
    """`/users/me` — the stored profile plus what the token says about the caller.

    `is_admin` is not a column: it comes from the Cognito group on the token
    that made this request, so it cannot drift from what the admin routes check.
    The client uses it only to decide what to *show*; the routes enforce it.
    """

    is_admin: bool = False
