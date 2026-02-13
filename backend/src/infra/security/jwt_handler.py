import os
from datetime import UTC, datetime, timedelta

import jwt

from src.infra.security.schemas import TokenPayload


class JWTHandler:
    """Handles JWT token encoding and decoding."""

    def __init__(self, algorithm: str = "HS256") -> None:
        """
        Initialize JWT handler.

        Args:
            algorithm: JWT signing algorithm (default: HS256)
        """
        self.secret_key = os.getenv("JWT_SECRET")
        if not self.secret_key:
            raise ValueError("JWT_SECRET environment variable is required")
        self.algorithm = algorithm

    def decode_token(self, token: str) -> TokenPayload:
        """
        Decode and validate JWT token.

        Args:
            token: JWT token string

        Returns:
            TokenPayload with user information

        Raises:
            jwt.ExpiredSignatureError: Token has expired
            jwt.InvalidTokenError: Token signature is invalid
            jwt.DecodeError: Token format is malformed
        """
        payload = jwt.decode(token, self.secret_key, algorithms=[self.algorithm])
        return TokenPayload(**payload)

    def create_token(self, user_id: str, email: str, expires_delta: timedelta | None = None) -> str:
        """
        Create a new JWT token (for testing purposes - in production, Cognito will create tokens).

        Args:
            user_id: User identifier
            email: User email
            expires_delta: Token expiration time (default: 1 hour)

        Returns:
            Encoded JWT token string
        """
        if expires_delta is None:
            expires_delta = timedelta(hours=1)

        expire = datetime.now(UTC) + expires_delta
        payload = {
            "sub": user_id,
            "email": email,
            "exp": int(expire.timestamp()),
        }
        return jwt.encode(payload, self.secret_key, algorithm=self.algorithm)
