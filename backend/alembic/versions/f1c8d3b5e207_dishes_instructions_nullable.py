"""a dish is a recipe without instructions: make instructions nullable

Implements the schema half of docs/adr/0007. `instructions` becomes NULL-able,
so a Recipe row can be a *dish* — a named thing with ingredients and a headcount,
which is exactly what a meal-plan slot needs and all it needs.

The lens is derived, not stored: "instructions IS NULL means it is a dish".
There is deliberately no `kind` column — writing the instructions later promotes
a dish into the recipe collection with no flag to maintain and no migration.

**This migration is one-way in practice.** The downgrade below restores NOT NULL,
which can only succeed while no instruction-less rows exist; once the planner has
created dishes it fails on them rather than silently deleting them. That is the
intended behaviour — see the ADR.

Revision ID: f1c8d3b5e207
Revises: e5a7c9d1b2f3
Create Date: 2026-09-11 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1c8d3b5e207"
down_revision: str | Sequence[str] | None = "e5a7c9d1b2f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INSTRUCTIONS_COMMENT = "NULL means this row is a *dish*, not a recipe — see docs/adr/0007. Writing instructions promotes it."


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        "recipes",
        "instructions",
        existing_type=sa.Text(),
        nullable=True,
        comment=INSTRUCTIONS_COMMENT,
    )


def downgrade() -> None:
    """Downgrade schema.

    Fails loudly if any dishes exist rather than inventing instructions for them
    or deleting the rows. Recovering from that is a product decision, not a
    migration's job.
    """
    op.alter_column(
        "recipes",
        "instructions",
        existing_type=sa.Text(),
        nullable=False,
        comment=None,
    )
