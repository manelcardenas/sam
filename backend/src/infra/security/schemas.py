from pydantic import BaseModel, Field


class TokenPayload(BaseModel):
    """JWT token payload schema."""

    sub: str = Field(description="Subject (user ID)")
    email: str = Field(description="User email")
    exp: int = Field(description="Expiration time (timestamp)")
