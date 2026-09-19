"""Every standalone script that talks to the database must load `.env` itself.

**The bug this exists to stop, which shipped twice in one week.** `src/main.py`
calls `load_dotenv()` and then imports the seed scripts, so anything run *through*
it inherits a loaded environment. Run the same script the way its own docstring
says to — `uv run python -m scripts.seed_grocery` — and nothing has loaded
anything, so `build_dsn()` dies on `KeyError: 'POSTGRES_HOST'`.

It is invisible in every other context: the app works, the tests work, CI works
(it sets `POSTGRES_DSN` explicitly). Only the documented command fails, which is
the one nobody runs until they need it.

Source inspection rather than execution, for the same reason
`test_enum_columns_match_migrations.py` reads source: importing these modules
would connect to a database, and the thing being checked is a property of the
file, not of a run.
"""

import ast
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"

# What "talks to the database" means here. `build_dsn` is the single funnel —
# every path to Postgres goes through it — so one name is enough.
NEEDS_ENV = "build_dsn"
LOADS_ENV = "load_dotenv"


def calls(tree: ast.Module, name: str) -> bool:
    return any(isinstance(node, ast.Call) and (getattr(node.func, "id", None) == name or getattr(node.func, "attr", None) == name) for node in ast.walk(tree))


def scripts() -> list[Path]:
    """Every script. Not just the ones with a `__main__` guard.

    An earlier version filtered on that, reasoning that only directly-runnable
    scripts can hit the problem. It filtered out nothing, and the rule is better
    without it: a module that reads the database should load the environment
    whether it is run or imported, and `load_dotenv()` twice is a no-op.
    """
    return sorted(SCRIPTS.glob("*.py"))


def test_there_are_scripts_to_check() -> None:
    """Without this, a glob that silently matched nothing would make every test
    below vacuously true — which is exactly how a guard stops guarding."""
    assert scripts()


@pytest.mark.parametrize("script", scripts(), ids=lambda p: p.name)
def test_a_script_that_reads_the_database_loads_the_environment(script: Path) -> None:
    tree = ast.parse(script.read_text())
    if not calls(tree, NEEDS_ENV):
        pytest.skip(f"{script.name} does not touch the database")

    assert calls(tree, LOADS_ENV), (
        f"{script.name} calls {NEEDS_ENV}() but never {LOADS_ENV}(). Run directly — which is what its docstring tells you to do — it will die on a missing POSTGRES_HOST."
    )
