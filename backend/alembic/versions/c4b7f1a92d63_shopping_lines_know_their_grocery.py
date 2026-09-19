"""Shopping-list lines carry a grocery key, and merge on it

Revision ID: c4b7f1a92d63
Revises: b6c9e28d41f7
Create Date: 2026-09-18

`huevos` and `eggs` merging into one line is the whole reason `grocery_items`
holds three names per row (ingredient-capture-plan §3.5), and it could not
happen: the merge key was the line's own normalised name, and the aisle lookup
matched that name against a vocabulary keyed on `key_for(name_es)`. Measured on
the 274 seeded rows, **87% of Catalan names and 92% of English names normalise
differently from their own key** — so anything not written in Spanish was
unmergeable and unsortable.

This adds the nullable `grocery_key` §6.1 specified and moves the unique index
onto `COALESCE(grocery_key, normalised_name)`.

**The backfill cannot collide, by construction.** It only sets the key on rows
where `normalised_name` is *already* exactly a vocabulary key, so the coalesced
value is the same string before and after and no two rows can start sharing one.
Cross-language merging begins with the next write instead of being applied
retroactively — which is also the honest behaviour: a line you already have is a
line you already decided about.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4b7f1a92d63"
down_revision: str | Sequence[str] | None = "b6c9e28d41f7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_INDEX = "uq_shopping_list_items_merge_key"


def upgrade() -> None:
    op.add_column(
        "shopping_list_items",
        sa.Column(
            "grocery_key",
            sa.String(length=255),
            nullable=True,
            comment="The grocery_items row this line means; NULL when the vocabulary does not know it",
        ),
    )
    op.create_index("ix_shopping_list_items_grocery_key", "shopping_list_items", ["grocery_key"])

    # Only where the name already *is* the key — see the docstring. No FK is
    # added: the vocabulary is curated reference data, and a constraint here
    # would let a shopping line block a correction to it.
    op.execute(
        sa.text(
            """
            UPDATE shopping_list_items AS s
               SET grocery_key = g.key
              FROM grocery_items AS g
             WHERE g.key = s.normalised_name
            """
        )
    )

    op.drop_index(_INDEX, table_name="shopping_list_items")
    op.execute(
        sa.text(
            f"""
            CREATE UNIQUE INDEX {_INDEX}
                ON shopping_list_items (plan_id, COALESCE(grocery_key, normalised_name), COALESCE(unit, ''))
            """
        )
    )


def downgrade() -> None:
    """Lossy where two lines merged across languages — they cannot be split back.

    Dropping the column loses which vocabulary row each line meant. A line that
    merged `Ceba` into `Cebolla` keeps the merged total under the first spelling
    used; there is no record of the two halves, because merging is addition.
    """
    op.drop_index(_INDEX, table_name="shopping_list_items")
    op.drop_index("ix_shopping_list_items_grocery_key", table_name="shopping_list_items")
    op.drop_column("shopping_list_items", "grocery_key")
    op.execute(
        sa.text(
            f"""
            CREATE UNIQUE INDEX {_INDEX}
                ON shopping_list_items (plan_id, normalised_name, COALESCE(unit, ''))
            """
        )
    )
