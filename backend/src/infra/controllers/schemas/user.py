from pydantic import BaseModel, Field


class UpdateMeRequest(BaseModel):
    """Request body for PATCH /users/me — the user-chosen display name."""

    display_name: str = Field(min_length=1, max_length=50)
