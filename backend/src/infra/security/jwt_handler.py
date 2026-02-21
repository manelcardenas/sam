import os
from typing import Any

import httpx
from jose import exceptions, jwk, jwt

from src.infra.security.schemas import TokenPayload


class JWTHandler:
    """Handles JWT token validation for AWS Cognito tokens."""

    def __init__(self, algorithm: str = "RS256") -> None:
        """
        Initialize JWT handler for Cognito token validation.

        Args:
            algorithm: JWT signing algorithm (default: RS256 for Cognito)
        """
        self.region = os.getenv("AWS_REGION", "eu-west-3")
        self.user_pool_id = os.getenv("COGNITO_USER_POOL_ID")
        self.client_id = os.getenv("COGNITO_CLIENT_ID")

        if not self.user_pool_id:
            raise ValueError("COGNITO_USER_POOL_ID environment variable is required")
        if not self.client_id:
            raise ValueError("COGNITO_CLIENT_ID environment variable is required")

        self.jwks_url = f"https://cognito-idp.{self.region}.amazonaws.com/{self.user_pool_id}/.well-known/jwks.json"
        self._keys: list[dict[str, Any]] | None = None  # Cache JWKS keys
        self.algorithm = algorithm

    def _get_public_keys(self) -> list[dict[str, Any]]:
        """Fetch Cognito JWKS keys (cached after first fetch)."""
        if self._keys is None:
            response = httpx.get(self.jwks_url, timeout=5)
            response.raise_for_status()
            self._keys = response.json()["keys"]
        return self._keys

    def decode_token(self, token: str) -> TokenPayload:
        """
        Decode and validate Cognito JWT token.

        Args:
            token: JWT token string from Cognito

        Returns:
            TokenPayload with user information

        Raises:
            jwt.ExpiredSignatureError: Token has expired
            jwt.JWTError: Token signature is invalid or malformed
        """
        # Get the unverified header to extract the "kid" (key ID)
        header = jwt.get_unverified_header(token)
        kid = header["kid"]

        # Find the corresponding public key in JWKS
        keys = self._get_public_keys()
        key = next((k for k in keys if k["kid"] == kid), None)
        if key is None:
            raise exceptions.JWTError("Public key not found in JWKS")

        # Construct the public key
        public_key = jwk.construct(key)

        # Decode and verify token
        try:
            payload = jwt.decode(
                token,
                public_key,
                algorithms=[self.algorithm],  # Cognito uses RS256
                audience=self.client_id,  # Validate the audience (client ID)
                options={"verify_at_hash": False},  # Don't verify at_hash claim (not needed for access tokens)
            )
            return TokenPayload(**payload)
        except Exception as e:
            raise exceptions.JWTError(f"Token validation failed: {e}") from e
