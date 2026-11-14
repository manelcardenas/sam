import os
import time
from functools import lru_cache
from threading import Lock
from typing import Any

import httpx
import jwt

from src.infra.security.schemas import TokenPayload

# An unknown `kid` normally means Cognito rotated its signing keys, and the
# right response is to refetch. But `kid` comes from an *unverified* token
# header, so anyone can send a random one — without a floor, that turns every
# unauthenticated request into an outbound HTTPS call to Cognito. Refetch at
# most this often; a real rotation is picked up within the minute, and a
# forged kid costs nothing after the first.
_JWKS_REFETCH_COOLDOWN_SECONDS = 60


def _region_from_pool_id(user_pool_id: str) -> str:
    """Cognito pool ids are `<region>_<suffix>`, e.g. `eu-west-3_aBcDeFgHi`.

    Deriving the region from the pool id rather than reading `AWS_REGION`
    matters: `AWS_REGION` is set by the Lambda runtime and describes where the
    *function* runs, which is a different fact that merely happens to match
    today. Relying on it means the JWKS URL silently points at the wrong region
    the moment the function moves — see routing-and-latency-plan.md §4.1.
    """
    region, separator, _ = user_pool_id.partition("_")
    if separator and "-" in region:
        return region
    # Unrecognised shape (a stub in tests, say) — fall back to the old behaviour.
    return os.getenv("AWS_REGION", "eu-west-3")


class JWTHandler:
    """Handles JWT token validation for AWS Cognito tokens.

    Construct via `get_jwt_handler()`, not directly: the JWKS cache lives on the
    instance, so a per-request instance means a per-request HTTPS round trip to
    Cognito. That was measured as one of the largest components of warm latency.
    """

    def __init__(self, algorithm: str = "RS256") -> None:
        """
        Initialize JWT handler for Cognito token validation.

        Args:
            algorithm: JWT signing algorithm (default: RS256 for Cognito)
        """
        self.user_pool_id = os.getenv("COGNITO_USER_POOL_ID")
        self.client_id = os.getenv("COGNITO_CLIENT_ID")

        if not self.user_pool_id:
            raise ValueError("COGNITO_USER_POOL_ID environment variable is required")
        if not self.client_id:
            raise ValueError("COGNITO_CLIENT_ID environment variable is required")

        self.region = _region_from_pool_id(self.user_pool_id)
        self.issuer = f"https://cognito-idp.{self.region}.amazonaws.com/{self.user_pool_id}"
        self.jwks_url = f"{self.issuer}/.well-known/jwks.json"
        self.algorithm = algorithm

        # Keyed by `kid` so an unknown key id is distinguishable from an empty
        # cache. Guarded by a lock because sync endpoints run in a threadpool.
        self._keys: dict[str, dict[str, Any]] | None = None
        self._fetched_at = 0.0
        self._lock = Lock()

    def _fetch_keys(self) -> dict[str, dict[str, Any]]:
        """Pure fetch. The caller records *when*, so the cooldown below can't be
        defeated by a fetcher that forgets to stamp it."""
        response = httpx.get(self.jwks_url, timeout=5)
        response.raise_for_status()
        return {key["kid"]: key for key in response.json()["keys"]}

    def _refresh(self) -> None:
        self._keys = self._fetch_keys()
        self._fetched_at = time.monotonic()

    def _public_key_for(self, kid: str) -> dict[str, Any] | None:
        """The signing key for `kid`, refetching once if it looks like a rotation."""
        with self._lock:
            if self._keys is None:
                self._refresh()
                assert self._keys is not None

            key = self._keys.get(kid)
            if key is not None:
                return key

            if time.monotonic() - self._fetched_at < _JWKS_REFETCH_COOLDOWN_SECONDS:
                return None  # recently refreshed, so this kid is simply bogus

            self._refresh()
            return self._keys.get(kid)

    def decode_token(self, token: str) -> TokenPayload:
        """
        Decode and validate a Cognito **ID token** (what the frontend sends).

        PyJWT, not python-jose: python-jose has an unfixed critical advisory
        (GHSA-3qf3-8w2g-rqmx, algorithm confusion via DER-encoded keys) and is
        barely maintained. Two differences that matter here:

        - The algorithm is pinned to RS256 and the key is built as an RSA key
          from the JWKS entry, so a token signed with HS256 using the public
          key as the secret is rejected.
        - A missing `aud` is an error, where python-jose silently skipped the
          check. Cognito *access* tokens have no `aud`, so only ID tokens of
          this app client pass; the frontend has only ever sent ID tokens.

        Raises:
            jwt.ExpiredSignatureError: Token has expired
            jwt.InvalidTokenError: anything else wrong with the token
        """
        # Unverified on purpose: only to pick the key. Malformed input raises
        # jwt.DecodeError, an InvalidTokenError.
        kid = jwt.get_unverified_header(token).get("kid")
        if not isinstance(kid, str):
            raise jwt.InvalidTokenError("Token header has no kid")

        key = self._public_key_for(kid)
        if key is None:
            raise jwt.InvalidTokenError("Public key not found in JWKS")

        try:
            signing_key = jwt.PyJWK(key, algorithm=self.algorithm)
            payload = jwt.decode(
                token,
                signing_key,
                algorithms=[self.algorithm],
                audience=self.client_id,
                issuer=self.issuer,
                options={"require": ["exp", "sub", "aud", "iss"]},
            )
            return TokenPayload(**payload)
        except jwt.InvalidTokenError:
            raise  # includes ExpiredSignatureError, so the API can say "expired"
        except Exception as e:  # a JWKS entry PyJWK can't use, a payload TokenPayload rejects
            raise jwt.InvalidTokenError(f"Token validation failed: {e}") from e


@lru_cache(maxsize=1)
def get_jwt_handler() -> JWTHandler:
    """The process-wide handler, so its JWKS cache survives across requests.

    Deliberately a cached *factory* rather than a module-level instance:
    `JWTHandler.__init__` raises when the Cognito env vars are missing, and at
    module scope that would take down the whole Lambda at import time instead
    of failing a single request. Construction stays lazy; only the caching is new.
    """
    return JWTHandler()
