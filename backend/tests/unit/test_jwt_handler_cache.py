import time
from typing import Any

import pytest
from jose import exceptions

from src.infra.security.jwt_handler import JWTHandler, _region_from_pool_id


class FakeJwks:
    """Stands in for Cognito's JWKS endpoint, counting how often it's hit."""

    def __init__(self, kids: list[str]) -> None:
        self.kids = kids
        self.fetches = 0

    def __call__(self) -> dict[str, dict[str, Any]]:
        self.fetches += 1
        return {kid: {"kid": kid, "kty": "RSA"} for kid in self.kids}


@pytest.fixture
def handler(monkeypatch: pytest.MonkeyPatch) -> JWTHandler:
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "eu-west-3_aBcDeFgHi")
    monkeypatch.setenv("COGNITO_CLIENT_ID", "client-123")
    return JWTHandler()


def test_keys_are_fetched_once_and_reused(handler: JWTHandler) -> None:
    jwks = FakeJwks(["key-1"])
    handler._fetch_keys = jwks  # type: ignore[method-assign]

    for _ in range(5):
        assert handler._public_key_for("key-1") is not None

    assert jwks.fetches == 1, "the whole point: one fetch, not one per request"


def test_unknown_kid_triggers_exactly_one_refetch(handler: JWTHandler) -> None:
    """A real Cognito key rotation must still be picked up."""
    jwks = FakeJwks(["old-key"])
    handler._fetch_keys = jwks  # type: ignore[method-assign]

    assert handler._public_key_for("old-key") is not None  # primes the cache
    handler._fetched_at = time.monotonic() - 3600  # pretend the cache is old
    jwks.kids = ["old-key", "new-key"]  # Cognito rotated

    assert handler._public_key_for("new-key") is not None
    assert jwks.fetches == 2


def test_unknown_kid_does_not_refetch_within_the_cooldown(handler: JWTHandler) -> None:
    """Otherwise an unauthenticated caller sending random kids becomes an
    amplifier: one outbound HTTPS call to Cognito per forged request."""
    jwks = FakeJwks(["key-1"])
    handler._fetch_keys = jwks  # type: ignore[method-assign]

    handler._public_key_for("key-1")  # primes the cache, fetch #1
    for _ in range(50):
        assert handler._public_key_for("forged-kid") is None

    assert jwks.fetches == 1, "50 forged requests must not cause 50 fetches"


def test_a_bogus_kid_is_still_rejected_after_a_refetch(handler: JWTHandler) -> None:
    """Caching must never widen what's accepted — an unknown key is an error."""
    jwks = FakeJwks(["key-1"])
    handler._fetch_keys = jwks  # type: ignore[method-assign]

    handler._public_key_for("key-1")
    handler._fetched_at = time.monotonic() - 3600  # cooldown expired

    assert handler._public_key_for("attacker-kid") is None
    assert jwks.fetches == 2  # it tried, and still said no


def test_decode_rejects_a_token_whose_key_is_unknown(handler: JWTHandler) -> None:
    handler._fetch_keys = FakeJwks(["key-1"])  # type: ignore[method-assign]
    # A syntactically valid JWT header naming a key that doesn't exist.
    token = "eyJhbGciOiJSUzI1NiIsImtpZCI6Im5vcGUifQ.e30.sig"  # gitleaks:allow

    with pytest.raises(exceptions.JWTError, match="Public key not found"):
        handler.decode_token(token)


class TestRegionDerivation:
    """The JWKS URL must follow the *pool's* region, not the Lambda's."""

    def test_region_comes_from_the_pool_id(self, handler: JWTHandler) -> None:
        assert handler.region == "eu-west-3"
        assert handler.jwks_url.startswith("https://cognito-idp.eu-west-3.amazonaws.com/")

    def test_pool_region_wins_over_the_runtime_region(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # The scenario that would silently 401 every user: function relocated,
        # user pool did not move (and cannot — pools can't cross regions).
        monkeypatch.setenv("AWS_REGION", "eu-central-1")
        monkeypatch.setenv("COGNITO_USER_POOL_ID", "eu-west-3_aBcDeFgHi")
        monkeypatch.setenv("COGNITO_CLIENT_ID", "client-123")

        assert JWTHandler().region == "eu-west-3"

    def test_falls_back_to_the_runtime_region_for_an_odd_pool_id(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AWS_REGION", "eu-central-1")
        assert _region_from_pool_id("no-underscore-here") == "eu-central-1"
