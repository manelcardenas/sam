"""Recipes carry tags, and a simple recipe can belong to one kitchen

Revision ID: b6e2d4f8a1c3
Revises: d1f3a7c58e20
Create Date: 2026-11-17

ADR-0009 §2 and §7. Three columns on `recipes`, all with defaults that describe
every existing row truthfully:

- `tags`: none yet. Tagging the existing recipes is a separate, reviewed pass.
- `visibility`: `public`, which is how every recipe has behaved so far.
- `kitchen_id`: NULL, because a public recipe belongs to no kitchen.

`optional` on an ingredient needs no migration: ingredients are JSONB, and an
item without the key reads as `false`.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b6e2d4f8a1c3"
down_revision: str | Sequence[str] | None = "d1f3a7c58e20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The dialect spelling, so `add_column` does not try to create the type a second time.
VISIBILITY = postgresql.ENUM("public", "kitchen", name="recipe_visibility_enum", create_type=False)


def upgrade() -> None:
    VISIBILITY.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "recipes",
        sa.Column("tags", postgresql.ARRAY(sa.String(32)), nullable=False, server_default=sa.text("'{}'"), comment="RecipeTag values — see the domain enum"),
    )
    op.add_column(
        "recipes",
        sa.Column(
            "visibility",
            VISIBILITY,
            nullable=False,
            server_default="public",
            comment="kitchen = a household's simple recipe, seen only there (ADR-0009 §2)",
        ),
    )
    op.add_column("recipes", sa.Column("kitchen_id", sa.UUID(), nullable=True))
    op.create_foreign_key("fk_recipes_kitchen_id", "recipes", "kitchens", ["kitchen_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_recipes_kitchen_id", "recipes", ["kitchen_id"])


def downgrade() -> None:
    """Loses which recipes were a kitchen's: they all become public again."""
    op.drop_index("ix_recipes_kitchen_id", table_name="recipes")
    op.drop_constraint("fk_recipes_kitchen_id", "recipes", type_="foreignkey")
    op.drop_column("recipes", "kitchen_id")
    op.drop_column("recipes", "visibility")
    op.drop_column("recipes", "tags")
    VISIBILITY.drop(op.get_bind(), checkfirst=True)
