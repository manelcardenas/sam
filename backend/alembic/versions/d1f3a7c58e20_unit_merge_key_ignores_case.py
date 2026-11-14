"""A shopping line's unit merges case-insensitively, in the index too

Revision ID: d1f3a7c58e20
Revises: a8d2e6f4c913
Create Date: 2026-11-14

`merge_key()` has always lowercased the unit, but the repository's lookup and the
unique index compared it as stored. A line in `Lonchas` was therefore invisible
to the lookup for `lonchas`, the next add of the same thing inserted a twin, and
the index refused it: three 500s on 16 Oct (`jamon cocido`, `Lonchas`).

The index now holds `lower(COALESCE(unit, ''))`, the same expression the lookup
uses. The old code could also store twins that differ only in case (`Lonchas`
first, then `lonchas`, passed the case-sensitive index), and those would stop
this index from building. Checked on production before writing it: 104 lines, 2
with capitals, none sharing a key once lowercased.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d1f3a7c58e20"
down_revision: str | Sequence[str] | None = "a8d2e6f4c913"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_INDEX = "uq_shopping_list_items_merge_key"


def _recreate(unit_expression: str) -> None:
    op.drop_index(_INDEX, table_name="shopping_list_items")
    op.execute(
        sa.text(
            f"""
            CREATE UNIQUE INDEX {_INDEX}
                ON shopping_list_items (plan_id, COALESCE(grocery_key, normalised_name), {unit_expression})
            """
        )
    )


def upgrade() -> None:
    _recreate("lower(COALESCE(unit, ''))")


def downgrade() -> None:
    """Always succeeds: the case-sensitive key is finer, so nothing unique becomes a duplicate."""
    _recreate("COALESCE(unit, '')")
