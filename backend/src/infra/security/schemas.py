from pydantic import BaseModel, Field


class TokenPayload(BaseModel):
    """JWT token payload schema for both ID and Access tokens."""

    sub: str = Field(description="Subject (user ID)")
    email: str | None = Field(default=None, description="User email (ID token only)")
    username: str | None = Field(default=None, description="Username (Access token)")
    token_use: str | None = Field(default=None, description="Token type: 'id' or 'access'")
    exp: int = Field(description="Expiration time (timestamp)")

    model_config = {"extra": "allow"}
