"""add display_name_set_by_user to users

Revision ID: b2f1a9c47d3e
Revises: 7973775c852c
Create Date: 2026-05-30 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2f1a9c47d3e"
down_revision: str | Sequence[str] | None = "7973775c852c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # server_default=false backfills existing rows, so everyone is prompted to
    # pick a real display name on their next login.
    op.add_column(
        "users",
        sa.Column("display_name_set_by_user", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("users", "display_name_set_by_user")
