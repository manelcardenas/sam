from pydantic import BaseModel, Field

# The Cognito user-pool group whose members may edit shared reference data — the
# grocery vocabulary today. Declared in `infra/lib/foundation/cognito-stack.ts`;
# the two names must match.
ADMIN_GROUP = "admins"


class TokenPayload(BaseModel):
    """JWT token payload schema for both ID and Access tokens."""

    sub: str = Field(description="Subject (user ID)")
    email: str | None = Field(default=None, description="User email (ID token only)")
    username: str | None = Field(default=None, description="Username (Access token)")
    token_use: str | None = Field(default=None, description="Token type: 'id' or 'access'")
    exp: int = Field(description="Expiration time (timestamp)")

    model_config = {"extra": "allow"}

    @property
    def is_admin(self) -> bool:
        """Whether Cognito put this user in the admin group.

        Read from the signed token rather than from the database, so being an
        admin is an AWS-side fact nobody can grant themselves through the API.
        `cognito:groups` is absent — not empty — for a user in no group.
        """
        groups = (self.model_extra or {}).get("cognito:groups") or []
        return ADMIN_GROUP in groups
