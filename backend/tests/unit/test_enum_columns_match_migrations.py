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

# `sa.Enum("a", "b", name="x")` — the labels, then the type's name.
DECLARATION = re.compile(r"sa\.Enum\(\s*((?:\"[^\"]+\"\s*,\s*)+)name=\"(?P<name>\w+)\"")


def _migration_enums() -> dict[str, list[str]]:
    """Every enum type the migrations create, as {type name: [labels]}."""
    found: dict[str, list[str]] = {}
    for migration in VERSIONS.glob("*.py"):
        for match in DECLARATION.finditer(migration.read_text(encoding="utf-8")):
            found[match.group("name")] = re.findall(r"\"([^\"]+)\"", match.group(1))
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
    from_migration = set(_migration_enums()[type_name])

    assert from_model == from_migration, (
        f"{type_name}: the ORM writes {sorted(from_model)} but the migration created "
        f"{sorted(from_migration)}. Postgres rejects any label not in the type — add "
        f"`values_callable=lambda enum: [m.value for m in enum]` if the ORM is sending "
        f"member names where the migration used values."
    )
