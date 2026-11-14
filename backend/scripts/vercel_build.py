"""Vercel's build step for the API: migrate the database, then seed reference data.

Wired up in `pyproject.toml` (`[tool.vercel.scripts] build`). Vercel runs it after
installing dependencies and before the new deployment goes live, so a failing
migration fails the build and production keeps serving the previous version.
That is the same expand-contract order the Lambda workflow used: schema first,
then the code that needs it.

**Production only.** Every other build (a preview, a local `vercel build`) skips
both steps, so nothing but a production deployment can touch the production
database. Previews are not built at all today (the project's ignore command
builds `main` only), so this is the second lock on that door, not the first.

**Direct endpoint, not the pooler.** `POSTGRES_DSN` is Neon's `-pooler` host,
which runs PgBouncer in transaction mode; Alembic's DDL and advisory locks need a
real session. Dropping `-pooler` from the host gives the direct endpoint of the
same database — the derivation `deploy-backend.yml` has always used.

Both steps are idempotent: `alembic upgrade head` does nothing at head, and the
grocery seed upserts on `key` (see `scripts/seed_grocery.py`).
"""

from __future__ import annotations

import os
import subprocess
import sys


def direct_dsn(pooled: str) -> str:
    """Neon's direct endpoint for the same database: the host without `-pooler`."""
    return pooled.replace("-pooler.", ".", 1)


def main() -> int:
    environment = os.environ.get("VERCEL_ENV", "")
    if environment != "production":
        print(f"vercel_build: VERCEL_ENV={environment or 'unset'} — not production, skipping migrations and seed")
        return 0

    pooled = os.environ.get("POSTGRES_DSN")
    if not pooled:
        print("vercel_build: POSTGRES_DSN is not set — refusing to deploy an API with no database", file=sys.stderr)
        return 1

    env = {**os.environ, "POSTGRES_DSN": direct_dsn(pooled)}
    # `python -m` from the venv the build installed, so no reliance on a console
    # script being on PATH. The local `alembic/` folder has no `__init__.py`, so it
    # cannot shadow the installed library here (that shadowing was a Lambda bundle
    # artefact: dependencies and code shared one directory there).
    for step in (["alembic", "upgrade", "head"], ["scripts.seed_grocery"]):
        print(f"vercel_build: python -m {' '.join(step)}", flush=True)
        subprocess.run([sys.executable, "-m", *step], env=env, check=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
