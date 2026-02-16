import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from src.infra.security.jwt_handler import JWTHandler
from src.infra.security.schemas import TokenPayload

# HTTPBearer automatically extracts "Authorization: Bearer <token>" header
security = HTTPBearer()


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> TokenPayload:
    """
    FastAPI dependency to validate JWT and extract current user.

    This function is injected into protected endpoints.
    It automatically extracts the JWT from the Authorization header,
    validates it, and returns the user information.

    Args:
        credentials: Automatically extracted by HTTPBearer from "Authorization: Bearer <token>"

    Returns:
        TokenPayload containing user information (sub, email)

    Raises:
        HTTPException 401: If token is missing, invalid, or expired

    Usage in controller:
        def list_recipes(self, current_user: TokenPayload = Depends(get_current_user)):
            # current_user.sub → user ID
            # current_user.email → user email
    """
    jwt_handler = JWTHandler()

    try:
        # credentials.credentials contains the raw JWT token string
        token_payload = jwt_handler.decode_token(credentials.credentials)
        return token_payload
    except jwt.exceptions.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.exceptions.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token signature",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as e:
        # Catch-all for any other errors
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        ) from e
