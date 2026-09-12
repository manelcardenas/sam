"""meal planner: a week belongs to a kitchen, not to a person

Implements docs/plans/meal-planner-plan.md §8.12. The old model had a direction:
one person owned the week and the other could read it and tick the list. Two
people who live together do not work that way — they both add dishes, they both
add to the list, and neither of them is the guest. So the plan moves to a
**kitchen**, a household both people are equally in.

WHAT THIS DOES WITH THE EXISTING DATA
-------------------------------------
Every user gets their own kitchen, and every plan moves to its owner's kitchen.
That preserves every week exactly where it was.

**Existing `plan_shares` rows are dropped without being converted**, and that is
deliberate rather than lazy. A share is not a membership: converting one would
have to *move* the guest out of their own kitchen into the sharer's, taking their
own weeks out of the planner and risking a collision on the new
`(kitchen_id, week_start)` key the moment both people had planned the same week.
Silently rearranging somebody's household on a migration is worse than asking
them to send one invitation. The route to rebuild it is `POST /kitchen/members`.

Revision ID: c7e4b93a615d
Revises: d9a3f7b1e482
Create Date: 2026-09-11 20:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "c7e4b93a615d"
down_revision: str | Sequence[str] | None = "d9a3f7b1e482"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "kitchens",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "kitchen_members",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("kitchen_id", UUID(as_uuid=True), sa.ForeignKey("kitchens.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("invited_by", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("left_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_kitchen_members_kitchen_id", "kitchen_members", ["kitchen_id"])
    op.create_index("ix_kitchen_members_user_id", "kitchen_members", ["user_id"])
    op.create_index("uq_kitchen_members_pair", "kitchen_members", ["kitchen_id", "user_id"], unique=True)
    # Partial, so the rows left behind by leaving and the rows still waiting to be
    # accepted do not count against it — which is what lets somebody hold an
    # invitation while still living in their own kitchen.
    op.create_index(
        "uq_kitchen_members_active_user",
        "kitchen_members",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("accepted_at IS NOT NULL AND left_at IS NULL"),
    )

    # One kitchen per existing account. The pairing is materialised first rather
    # than re-derived by row order afterwards: `INSERT ... SELECT` gives no way to
    # carry the source row alongside the generated id, and matching the two tables
    # up by position later would be a correctness argument about ORDER BY rather
    # than a fact in the data.
    op.execute("CREATE TEMP TABLE kitchen_seed AS SELECT id AS user_id, gen_random_uuid() AS kitchen_id FROM users")
    op.execute("INSERT INTO kitchens (id) SELECT kitchen_id FROM kitchen_seed")
    op.execute("INSERT INTO kitchen_members (kitchen_id, user_id, accepted_at) SELECT kitchen_id, user_id, now() FROM kitchen_seed")
    op.execute("DROP TABLE kitchen_seed")

    # ── meal_plans: owned by a kitchen, started by a person ──────────────────
    op.add_column("meal_plans", sa.Column("kitchen_id", UUID(as_uuid=True), nullable=True))
    op.execute(
        """
        UPDATE meal_plans p
        SET kitchen_id = m.kitchen_id
        FROM kitchen_members m
        WHERE m.user_id = p.owner_id
        """
    )
    op.alter_column("meal_plans", "kitchen_id", nullable=False)
    op.create_foreign_key("fk_meal_plans_kitchen_id", "meal_plans", "kitchens", ["kitchen_id"], ["id"])
    op.create_index("ix_meal_plans_kitchen_id", "meal_plans", ["kitchen_id"])

    # The owner becomes attribution. Renamed rather than dropped and re-added, so
    # "who started this week" survives the move instead of being invented as NULL.
    op.alter_column("meal_plans", "owner_id", new_column_name="created_by", nullable=True)
    # The old foreign key restricted deletes, which was right when the column
    # decided who could write. Now it only records a name, so a departed account
    # must empty it rather than pin the week in place.
    op.drop_constraint("meal_plans_owner_id_fkey", "meal_plans", type_="foreignkey")
    op.create_foreign_key("fk_meal_plans_created_by", "meal_plans", "users", ["created_by"], ["id"], ondelete="SET NULL")

    op.drop_index("uq_meal_plans_owner_week", table_name="meal_plans")
    op.create_index("uq_meal_plans_kitchen_week", "meal_plans", ["kitchen_id", "week_start"], unique=True)

    # ── attribution on the rows two people both write ────────────────────────
    for table in ("plan_entries", "shopping_list_items"):
        op.add_column(table, sa.Column("created_by", sa.String(), nullable=True))
        op.create_foreign_key(f"fk_{table}_created_by", table, "users", ["created_by"], ["id"], ondelete="SET NULL")
        # Backfilled from the week's own author: before kitchens there was only
        # ever one person writing these, and leaving them NULL would render every
        # existing row as "nobody added this".
        op.execute(f"UPDATE {table} r SET created_by = p.created_by FROM meal_plans p WHERE p.id = r.plan_id")

    op.drop_index("ix_plan_shares_user_id", table_name="plan_shares")
    op.drop_table("plan_shares")


def downgrade() -> None:
    """Downgrade schema."""
    op.create_table(
        "plan_shares",
        sa.Column("plan_id", UUID(as_uuid=True), sa.ForeignKey("meal_plans.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_plan_shares_user_id", "plan_shares", ["user_id"])

    for table in ("plan_entries", "shopping_list_items"):
        op.drop_constraint(f"fk_{table}_created_by", table, type_="foreignkey")
        op.drop_column(table, "created_by")

    op.drop_index("uq_meal_plans_kitchen_week", table_name="meal_plans")
    # A plan whose kitchen has two members would collide on the old owner key, so
    # the down path keeps only the founder's weeks and hands the rest to whoever
    # the kitchen was created for. Reversing a merge cannot be lossless.
    op.execute(
        """
        UPDATE meal_plans p
        SET created_by = m.user_id
        FROM (
            SELECT DISTINCT ON (kitchen_id) kitchen_id, user_id
            FROM kitchen_members WHERE accepted_at IS NOT NULL ORDER BY kitchen_id, created_at
        ) m
        WHERE m.kitchen_id = p.kitchen_id
        """
    )
    op.drop_constraint("fk_meal_plans_created_by", "meal_plans", type_="foreignkey")
    op.alter_column("meal_plans", "created_by", new_column_name="owner_id", nullable=False)
    op.create_foreign_key("meal_plans_owner_id_fkey", "meal_plans", "users", ["owner_id"], ["id"])
    op.create_index("uq_meal_plans_owner_week", "meal_plans", ["owner_id", "week_start"], unique=True)

    op.drop_index("ix_meal_plans_kitchen_id", table_name="meal_plans")
    op.drop_constraint("fk_meal_plans_kitchen_id", "meal_plans", type_="foreignkey")
    op.drop_column("meal_plans", "kitchen_id")

    op.drop_index("uq_kitchen_members_active_user", table_name="kitchen_members")
    op.drop_index("uq_kitchen_members_pair", table_name="kitchen_members")
    op.drop_index("ix_kitchen_members_user_id", table_name="kitchen_members")
    op.drop_index("ix_kitchen_members_kitchen_id", table_name="kitchen_members")
    op.drop_table("kitchen_members")
    op.drop_table("kitchens")
