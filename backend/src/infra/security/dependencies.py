import sys

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from src.domain.ports import UserRepository
from src.infra.security.jwt_handler import get_jwt_handler
from src.infra.security.schemas import TokenPayload

# HTTPBearer automatically extracts "Authorization: Bearer <token>" header
security = HTTPBearer()

# Set once at app startup via configure_user_repository(). The auth dependency
# uses it to lazily upsert the authenticated user into the local `users` table
# so that recipes.created_by always has a matching FK target.
_user_repository: UserRepository | None = None


def configure_user_repository(repository: UserRepository) -> None:
    global _user_repository
    _user_repository = repository


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> TokenPayload:
    """
    FastAPI dependency to validate JWT and extract current user.

    Also lazily provisions the user into the local `users` table on each
    authenticated request (idempotent). This avoids a separate signup step
    for Cognito-authenticated users.

    Args:
        credentials: Automatically extracted by HTTPBearer from "Authorization: Bearer <token>"

    Returns:
        TokenPayload containing user information (sub, email)

    Raises:
        HTTPException 401: If token is missing, invalid, or expired
    """
    # Shared across requests in this container — a fresh JWTHandler here meant
    # re-downloading Cognito's public keys on every single API call.
    jwt_handler = get_jwt_handler()

    try:
        token_payload = jwt_handler.decode_token(credentials.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token signature",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as e:
        # Log actual error for CloudWatch debugging
        print(f"❌ Token validation error: {type(e).__name__}: {e}", file=sys.stderr)

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        ) from e

    if _user_repository is not None and token_payload.email:
        try:
            _user_repository.ensure_user(token_payload.sub, token_payload.email)
        except Exception as e:
            # Provisioning failure shouldn't 500 auth — log and continue.
            # Downstream write endpoints will surface the FK error if it
            # actually impacts them.
            print(f"⚠️  User provisioning failed for {token_payload.sub}: {type(e).__name__}: {e}", file=sys.stderr)

    return token_payload


def require_admin(current_user: TokenPayload = Depends(get_current_user)) -> TokenPayload:
    """`get_current_user`, plus a 403 for anybody outside the admin group.

    A 403 rather than a 404: the routes are no secret — they are in the gateway
    stack and the OpenAPI document — and pretending they do not exist would only
    make a missing group membership look like a deploy problem.
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admins only")
    return current_user
