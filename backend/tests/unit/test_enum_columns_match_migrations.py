"""Every Enum column persists exactly the labels its migration created.

**This test exists because the alternative found the bug in production.** The
meal planner shipped with `Enum(PlanStatus, name="plan_status_enum")`, which
looks right and is wrong: SQLAlchemy persists the member *name* by default
("PLANNING"), while the migration created the type with the lowercase *values*.
Every insert failed with

    invalid input value for enum plan_status_enum: "PLANNING"

and nothing caught it, because every other suite runs against the in-memory
fake — `PostgresMealPlanRepository` had never executed. This is the cheap half
of that gap: it needs no database, and it compares the two declarations that
have to agree.

It parses the migration source rather than synthesising it. Crude, but the thing
being guarded is literally a mismatch between two lists of strings in two files.
"""

import re
from pathlib import Path

import pytest
from sqlalchemy import Enum as SAEnum

from src.infra.db import Base

VERSIONS = Path(__file__).resolve().parents[2] / "alembic" / "versions"

# `sa.Enum("a", "b", name="x")` or `postgresql.ENUM("a", "b", name="x")` — the
# labels, then the type's name.
#
# **Both spellings, because a migration that needs `create_type=False` has to use
# the dialect one.** Knowing only `sa.Enum` meant an enum could be introduced in
# the spelling this file does not recognise and go completely unguarded — which
# is the precise failure the module docstring above describes.
DECLARATION = re.compile(r"(?:sa\.Enum|postgresql\.ENUM)\(\s*((?:\"[^\"]+\"\s*,\s*)+)name=\"(?P<name>\w+)\"")


# `ALTER TYPE food_type_enum ADD VALUE 'GUARNICION'` — extending a type that
# already exists. The third spelling this file has to know, and the one that is
# easiest to miss: a value added this way never appears in any `sa.Enum(...)`
# call, so without this an extended type looks frozen at whatever it was created
# with and the new member goes entirely unguarded.
#
# Deliberately **not** matching raw `CREATE TYPE` SQL. Declarations come from the
# two Python spellings above; a downgrade that rebuilds a type by hand would
# otherwise be read as the truth and silently undo an extension.
ADDITION = re.compile(r"ALTER TYPE (?P<name>\w+) ADD VALUE (?:IF NOT EXISTS )?'(?P<label>[^']+)'")


# Labels still in a Postgres type that the ORM deliberately no longer writes.
# Postgres cannot drop an enum value without rebuilding the type, so retiring one
# leaves it behind — listed here, by name, so that is a decision somebody wrote
# down rather than a mismatch this test learned to tolerate.
RETIRED = {
    # meal-planner-plan §8.14: the closed-calendar step was removed, and
    # migration a8d2e6f4c913 moved every such week back to `planning`.
    "plan_status_enum": {"calendar_closed"},
}


def _migration_enums() -> dict[str, list[str]]:
    """Every enum type the migrations create, as {type name: [labels]}."""
    found: dict[str, list[str]] = {}
    sources = [migration.read_text(encoding="utf-8") for migration in sorted(VERSIONS.glob("*.py"))]

    for source in sources:
        for match in DECLARATION.finditer(source):
            found[match.group("name")] = re.findall(r"\"([^\"]+)\"", match.group(1))

    # Applied in a second pass so an addition is never wiped out by a declaration
    # parsed later — filename order is not migration order.
    for source in sources:
        for match in ADDITION.finditer(source):
            labels = found.setdefault(match.group("name"), [])
            if match.group("label") not in labels:
                labels.append(match.group("label"))

    return found


def _model_enums() -> dict[str, list[str]]:
    """Every enum type the ORM will write, as {type name: [labels]}."""
    return {
        column.type.name: list(column.type.enums)
        for table in Base.metadata.tables.values()
        for column in table.columns
        if isinstance(column.type, SAEnum) and column.type.name
    }


def test_the_migrations_declare_an_enum_for_every_one_the_orm_writes() -> None:
    missing = set(_model_enums()) - set(_migration_enums())

    assert not missing, f"No migration creates these enum types: {sorted(missing)}"


@pytest.mark.parametrize("type_name", sorted(_model_enums()))
def test_the_orm_writes_the_labels_the_migration_created(type_name: str) -> None:
    """Order does not matter to Postgres for validity, so this compares sets.

    What matters is that no label the ORM can emit is absent from the type —
    that is the insert that fails at runtime rather than at import.
    """
    from_model = set(_model_enums()[type_name])
    from_migration = set(_migration_enums()[type_name]) - RETIRED.get(type_name, set())

    assert from_model == from_migration, (
        f"{type_name}: the ORM writes {sorted(from_model)} but the migration created "
        f"{sorted(from_migration)}. Postgres rejects any label not in the type — add "
        f"`values_callable=lambda enum: [m.value for m in enum]` if the ORM is sending "
        f"member names where the migration used values."
    )
