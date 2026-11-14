"""The Vercel build step must only ever migrate production, and only through the direct endpoint."""

import subprocess

import pytest

from scripts import vercel_build

POOLED = "postgresql+psycopg2://user:pw@ep-little-morning-abc123-pooler.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require"


def test_direct_dsn_drops_pooler_from_the_host() -> None:
    assert vercel_build.direct_dsn(POOLED) == POOLED.replace("-abc123-pooler.c-3", "-abc123.c-3")


def test_direct_dsn_leaves_a_direct_dsn_alone() -> None:
    direct = vercel_build.direct_dsn(POOLED)
    assert vercel_build.direct_dsn(direct) == direct


@pytest.mark.parametrize("environment", [None, "preview", "development"])
def test_skips_everything_outside_production(monkeypatch: pytest.MonkeyPatch, environment: str | None) -> None:
    if environment is None:
        monkeypatch.delenv("VERCEL_ENV", raising=False)
    else:
        monkeypatch.setenv("VERCEL_ENV", environment)
    monkeypatch.setenv("POSTGRES_DSN", POOLED)
    calls: list[list[str]] = []
    monkeypatch.setattr(subprocess, "run", lambda args, **_: calls.append(args))

    assert vercel_build.main() == 0
    assert calls == []


def test_production_without_a_database_fails_the_build(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VERCEL_ENV", "production")
    monkeypatch.delenv("POSTGRES_DSN", raising=False)

    assert vercel_build.main() == 1


def test_production_migrates_then_seeds_against_the_direct_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VERCEL_ENV", "production")
    monkeypatch.setenv("POSTGRES_DSN", POOLED)
    calls: list[tuple[list[str], str]] = []

    def fake_run(args: list[str], env: dict[str, str], check: bool) -> None:
        assert check, "a failed step must fail the build"
        calls.append((args[1:], env["POSTGRES_DSN"]))

    monkeypatch.setattr(subprocess, "run", fake_run)

    assert vercel_build.main() == 0
    assert [args for args, _ in calls] == [["-m", "alembic", "upgrade", "head"], ["-m", "scripts.seed_grocery"]]
    assert all("-pooler" not in dsn for _, dsn in calls)
