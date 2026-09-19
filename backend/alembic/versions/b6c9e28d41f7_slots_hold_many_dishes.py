"""a slot holds a flat list of dishes, and a guarnicion is a food type

Implements docs/plans/ingredient-capture-plan.md §5 — Phase C.

WHY A FLAT LIST RATHER THAN MAIN-PLUS-SIDES
-------------------------------------------
"Carne en salsa con arroz" could not be planned at all: `uq_plan_entries_slot`
made `(plan, date, meal)` unique, so a slot held one dish and assigning a second
replaced the first.

The obvious model is a main dish with subordinate *acompañantes*. It is wrong,
and "ensalada con pollo" is what proves it — neither is the side. Rice is a side
under carne en salsa on Tuesday and the dish itself in arroz a la cubana on
Thursday, so "side" cannot be a property of the food. And nothing would behave
differently: both contribute ingredients, both scale by servings, both appear in
the archive, both delete independently. A distinction with no behaviour is an
adjective, not an entity — the argument ADR-0007 already settled once.

So entries in a slot are equal and ordered by when they were added. No
`position` column until somebody asks to reorder; no `role` column, because it
would only be cashable if a behaviour depending on it turned up, and none did.

WHAT REPLACES THE UNIQUE KEY
----------------------------
`(plan, date, meal, recipe_id)`, partial on `recipe_id IS NOT NULL`. It stops the
same recipe being added to one slot twice while leaving room for several one-off
text entries — which carry no recipe id and are the right answer for a Tuesday
you are not cooking ("sobras", "cena fuera").

WHY `guarnicion` IS A FOOD TYPE
-------------------------------
`Arroz blanco` has to live somewhere, and the instinct is a "Básicos" section in
the collection. ADR-0007 says no from experience: that exact split shipped and
was deleted the same day, because it *hid rows*. `food_type` already carries
`postre` and `aperitivo` — words of the same kind, set deliberately by a person —
and the filter chips chips already narrow on that axis, so this needs no new UI
at all.

Revision ID: b6c9e28d41f7
Revises: a1f4c7e930b2
Create Date: 2026-09-12 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b6c9e28d41f7"
down_revision: str | Sequence[str] | None = "a1f4c7e930b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# NOTE ON THE LITERALS BELOW
# --------------------------
# `GUARNICION` is written out at every use rather than held in a constant, and
# that is not carelessness: `tests/unit/test_enum_columns_match_migrations.py`
# reads enum labels out of this file's *source text*, so an f-string leaves it
# parsing `'{_NEW_FOOD_TYPE}'` and the new member goes unguarded.
#
# Uppercase because `food_type_enum` was created with member *names* in the
# initial migration, before SQLAlchemy's default was questioned. Newer enums
# here store lowercase values (see `MealPlanModel.status`), which reads better,
# but changing this one now is a data migration for no behavioural gain — and a
# type with both conventions inside it would be worse than either.


def upgrade() -> None:
    """Upgrade schema."""
    # IF NOT EXISTS so a half-applied run is re-runnable. Postgres 12+ permits
    # this inside a transaction as long as the new value is not *used* in the
    # same one, which nothing here does.
    op.execute("ALTER TYPE food_type_enum ADD VALUE IF NOT EXISTS 'GUARNICION'")

    op.drop_index("uq_plan_entries_slot", table_name="plan_entries")
    op.create_index(
        "uq_plan_entries_slot_dish",
        "plan_entries",
        ["plan_id", "date", "meal", "recipe_id"],
        unique=True,
        postgresql_where=sa.text("recipe_id IS NOT NULL"),
    )


def downgrade() -> None:
    """Downgrade schema.

    **Lossy, and loudly so.** Going back to one dish per slot means deciding
    which dish each slot keeps, and there is no answer the data can supply — so
    this keeps the one added first and deletes the rest, which is the only choice
    that is stable rather than arbitrary. A week that said "carne en salsa and
    arroz" comes back saying "carne en salsa".

    Postgres cannot remove a value from an enum, so the type is rebuilt. Rows
    using `GUARNICION` become `COMIDA`: a guarnición is food, which is the least
    wrong of the four surviving words.
    """
    op.execute(
        """
        DELETE FROM plan_entries WHERE id IN (
            SELECT id FROM (
                SELECT id, row_number() OVER (
                    PARTITION BY plan_id, date, meal ORDER BY created_at, id
                ) AS rank FROM plan_entries
            ) ranked WHERE rank > 1
        )
        """
    )

    op.drop_index("uq_plan_entries_slot_dish", table_name="plan_entries")
    op.create_index("uq_plan_entries_slot", "plan_entries", ["plan_id", "date", "meal"], unique=True)

    op.execute("UPDATE recipes SET food_type = 'COMIDA' WHERE food_type = 'GUARNICION'")
    op.execute("ALTER TYPE food_type_enum RENAME TO food_type_enum_old")
    op.execute("CREATE TYPE food_type_enum AS ENUM ('BEBIDA', 'POSTRE', 'COMIDA', 'APERITIVO')")
    op.execute("ALTER TABLE recipes ALTER COLUMN food_type TYPE food_type_enum USING food_type::text::food_type_enum")
    op.execute("DROP TYPE food_type_enum_old")
