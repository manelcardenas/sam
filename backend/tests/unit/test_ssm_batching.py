"""Batched SecureString reads (routing-and-latency-plan.md §4.8).

The DSN and the Geoapify key used to be two sequential GetParameter calls, each
with its own KMS decrypt, on every cold start. These tests pin the property
that matters — *one* call serves both callers — plus the two different failure
policies, which are deliberately not the same.
"""

import pytest

from src.infra import ssm
from src.infra.adapters.places.geoapify_places_provider import resolve_geoapify_api_key
from src.infra.db.engine import build_dsn


class FakeSsm:
    def __init__(self, values: dict[str, str]) -> None:
        self.values = values
        self.calls: list[list[str]] = []

    def get_parameters(self, *, Names: list[str], WithDecryption: bool) -> dict:  # noqa: N803
        assert WithDecryption is True, "SecureStrings are useless undecrypted"
        self.calls.append(list(Names))
        return {
            "Parameters": [{"Name": n, "Value": self.values[n]} for n in Names if n in self.values],
            "InvalidParameters": [n for n in Names if n not in self.values],
        }


@pytest.fixture
def ssm_env(monkeypatch: pytest.MonkeyPatch):  # noqa: ANN201
    """Lambda-shaped env: parameter *names*, no plain-value shortcuts."""
    for var in ("POSTGRES_DSN", "POSTGRES_HOST", "GEOAPIFY_API_KEY"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("POSTGRES_DSN_PARAM", "/sam/dsn")
    monkeypatch.setenv("GEOAPIFY_API_KEY_PARAM", "/sam/geoapify")
    ssm.reset_cache()
    yield monkeypatch
    ssm.reset_cache()


def test_both_secrets_come_from_a_single_call(ssm_env: pytest.MonkeyPatch) -> None:
    fake = FakeSsm({"/sam/dsn": "postgresql://db", "/sam/geoapify": "geo-key"})
    ssm_env.setattr(ssm, "_ssm_client", lambda: fake)

    assert build_dsn() == "postgresql://db"
    assert resolve_geoapify_api_key() == "geo-key"

    assert len(fake.calls) == 1, "two callers, one round trip — that's the whole fix"
    assert sorted(fake.calls[0]) == ["/sam/dsn", "/sam/geoapify"]


def test_the_second_caller_does_not_hit_ssm_again(ssm_env: pytest.MonkeyPatch) -> None:
    fake = FakeSsm({"/sam/dsn": "postgresql://db", "/sam/geoapify": "geo-key"})
    ssm_env.setattr(ssm, "_ssm_client", lambda: fake)

    for _ in range(3):
        build_dsn()
        resolve_geoapify_api_key()

    assert len(fake.calls) == 1


def test_a_missing_geoapify_key_is_survivable(ssm_env: pytest.MonkeyPatch) -> None:
    """Unchanged policy: /places/* answers 503, the rest of the app still boots."""
    fake = FakeSsm({"/sam/dsn": "postgresql://db"})  # no geoapify entry
    ssm_env.setattr(ssm, "_ssm_client", lambda: fake)

    assert build_dsn() == "postgresql://db"
    assert resolve_geoapify_api_key() is None


def test_a_missing_dsn_is_fatal(ssm_env: pytest.MonkeyPatch) -> None:
    """Also unchanged: get_parameter used to raise. Batching returns InvalidParameters
    instead of raising, so build_dsn has to enforce this itself."""
    fake = FakeSsm({"/sam/geoapify": "geo-key"})  # no dsn entry
    ssm_env.setattr(ssm, "_ssm_client", lambda: fake)

    with pytest.raises(RuntimeError, match="/sam/dsn"):
        build_dsn()


def test_plain_env_vars_still_bypass_ssm_entirely(monkeypatch: pytest.MonkeyPatch) -> None:
    """Local development must never need boto3 or AWS credentials."""
    monkeypatch.setenv("POSTGRES_DSN", "postgresql://localhost/dev")
    monkeypatch.setenv("GEOAPIFY_API_KEY", "local-key")
    monkeypatch.setattr(ssm, "_ssm_client", lambda: pytest.fail("SSM must not be touched locally"))
    ssm.reset_cache()

    assert build_dsn() == "postgresql://localhost/dev"
    assert resolve_geoapify_api_key() == "local-key"
