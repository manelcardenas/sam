"""make users.display_name nullable, drop display_name_set_by_user

A NULL display_name now *is* the "user hasn't chosen a name yet" signal, so the
separate boolean flag is redundant. Rows whose name was never chosen (flag
false) are reset to NULL so the first-login gate still picks them up.

Revision ID: c3d2e1f50a8b
Revises: b2f1a9c47d3e
Create Date: 2026-05-30 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3d2e1f50a8b"
down_revision: str | Sequence[str] | None = "b2f1a9c47d3e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # 1. Allow NULL names.
    op.alter_column("users", "display_name", existing_type=sa.String(50), nullable=True)
    # 2. Null out the auto-derived placeholders so those users are re-prompted.
    op.execute("UPDATE users SET display_name = NULL WHERE display_name_set_by_user = false")
    # 3. The flag is now redundant — NULL carries the same information.
    op.drop_column("users", "display_name_set_by_user")


def downgrade() -> None:
    """Downgrade schema.

    Best-effort reverse: a name was "chosen" iff it is non-NULL. NULL names are
    backfilled from the email prefix so the NOT NULL constraint can be restored
    (may collide on the UNIQUE index if two prefixes match — acceptable for a
    dev-only downgrade).
    """
    op.add_column(
        "users",
        sa.Column("display_name_set_by_user", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute("UPDATE users SET display_name_set_by_user = true WHERE display_name IS NOT NULL")
    op.execute("UPDATE users SET display_name = split_part(email, '@', 1) WHERE display_name IS NULL")
    op.alter_column("users", "display_name", existing_type=sa.String(50), nullable=False)
