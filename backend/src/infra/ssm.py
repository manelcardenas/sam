import logging
import os
from functools import lru_cache
from typing import Any, Protocol

logger = logging.getLogger(__name__)

# Every SecureString the app reads at startup. Listing them here is what makes
# a single batched call possible: the first caller cannot know who comes next.
_PARAMETER_NAME_ENV_VARS = ("POSTGRES_DSN_PARAM", "GEOAPIFY_API_KEY_PARAM")


class SsmClient(Protocol):
    """Just the call we make. Structural typing because boto3 is supplied by the
    Lambda runtime rather than declared as a dependency, so its stubs aren't
    importable here."""

    def get_parameters(self, *, Names: list[str], WithDecryption: bool) -> dict[str, Any]: ...  # noqa: N803


def _ssm_client() -> SsmClient:
    # boto3 is provided by the Lambda runtime and imported lazily, so local runs
    # (which read plain env vars) never need it installed. A seam for tests too.
    import boto3

    return boto3.client("ssm")


@lru_cache(maxsize=1)
def _fetch_all() -> dict[str, str]:
    """One decrypted `get_parameters` call for every configured name."""
    names = [name for var in _PARAMETER_NAME_ENV_VARS if (name := os.environ.get(var))]
    if not names:
        return {}

    response = _ssm_client().get_parameters(Names=names, WithDecryption=True)
    # Absent names come back under InvalidParameters rather than raising, which
    # suits us: a missing Geoapify key must not stop the app from booting. The
    # caller decides whether its own parameter was required.
    missing = response.get("InvalidParameters") or []
    if missing:
        logger.warning("SSM parameters not found: %s", ", ".join(missing))
    return {parameter["Name"]: parameter["Value"] for parameter in response["Parameters"]}


def read_secure_parameter(name: str) -> str | None:
    """The decrypted value for `name`, or None if SSM doesn't have it."""
    return _fetch_all().get(name)


def reset_cache() -> None:
    """Test seam — the cache is process-wide and would otherwise leak between tests."""
    _fetch_all.cache_clear()
