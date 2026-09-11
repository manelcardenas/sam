"""meal planner: sharing a week, read-and-tick only

Implements docs/plans/meal-planner-plan.md §4.3. The scenario is Martina plans
the week and you both shop: you need to see her calendar and tick things off her
list, not to edit her Wednesday.

**This is the "additive" half of §4.2's argument.** The plan had an owner from
day one precisely so sharing could arrive as a join table rather than as a
retrofit deciding retroactively who owns what.

The table carries no permission column on purpose. Read-and-tick is the only
level v1 has, and "can_edit BOOLEAN" added now would be a column that is false
on every row and answers a question nobody has asked yet. When full shared
editing is wanted (§5.2's trigger: when read-and-tick provably is not enough) it
is one ALTER TABLE.

Revision ID: b7d2f4a91c65
Revises: a4e6b8c02d19
Create Date: 2026-09-11 16:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "b7d2f4a91c65"
down_revision: str | Sequence[str] | None = "a4e6b8c02d19"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "plan_shares",
        sa.Column("plan_id", UUID(as_uuid=True), sa.ForeignKey("meal_plans.id", ondelete="CASCADE"), primary_key=True),
        # CASCADE here too: a deleted account should not leave a share row
        # granting access to a user id that no longer resolves to anyone.
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    # The composite primary key already covers (plan_id, user_id) lookups. This
    # is the other direction — "which plans am I a guest on?" — which runs on
    # every load of the planner page and would otherwise be a sequential scan.
    op.create_index("ix_plan_shares_user_id", "plan_shares", ["user_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_plan_shares_user_id", table_name="plan_shares")
    op.drop_table("plan_shares")
