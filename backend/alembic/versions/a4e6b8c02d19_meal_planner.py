"""meal planner: plans, entries and the shopping list

Four tables implementing docs/plans/meal-planner-plan.md §8.3. Sharing
(`plan_shares`) is deliberately NOT here — it is Phase D, and §4.2's argument for
an owner from day one is precisely that adding sharing later is additive.

Two things in here are load-bearing and easy to get wrong:

1. **The shopping list's unique index uses `COALESCE(unit, '')`, not `unit`.**
   Postgres treats NULLs as distinct in a unique constraint, so indexing `unit`
   directly would let two `huevos` rows exist side by side — and most household
   ingredients have no unit, which makes that the common case rather than an
   edge case. The upsert uses the same expression.

2. **`recipe_id` is `ON DELETE SET NULL`, and the dish name is duplicated onto
   the row.** The list is a saved artifact (§4.5) and so is the calendar: tidying
   up the recipe collection in November must not empty out what you ate in
   August. `CASCADE` here would do exactly that, quietly.

Revision ID: a4e6b8c02d19
Revises: f1c8d3b5e207
Create Date: 2026-09-11 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "a4e6b8c02d19"
down_revision: str | Sequence[str] | None = "f1c8d3b5e207"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MEAL_ENUM = sa.Enum("lunch", "dinner", name="meal_enum")
STATUS_ENUM = sa.Enum("planning", "calendar_closed", "list_closed", name="plan_status_enum")


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "meal_plans",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.func.gen_random_uuid()),
        sa.Column("owner_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False, comment="Always a Monday — normalised server-side so one week can't exist twice"),
        sa.Column("status", STATUS_ENUM, nullable=False, server_default="planning"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    # One plan per person per week. The owner is in the key because the plan
    # belongs to a person (§4.2) — two people planning the same week is normal.
    op.create_index("uq_meal_plans_owner_week", "meal_plans", ["owner_id", "week_start"], unique=True)

    op.create_table(
        "plan_entries",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.func.gen_random_uuid()),
        sa.Column("plan_id", UUID(as_uuid=True), sa.ForeignKey("meal_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("meal", MEAL_ENUM, nullable=False),
        sa.Column(
            "recipe_id",
            UUID(as_uuid=True),
            sa.ForeignKey("recipes.id", ondelete="SET NULL"),
            nullable=True,
            comment="NULL once the recipe is deleted; dish_name keeps the history readable",
        ),
        sa.Column("dish_name", sa.String(length=255), nullable=False, comment="Snapshot — the plan is a record of what you ate, not a live view of the collection"),
        sa.Column("servings", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("servings >= 1", name="ck_plan_entries_servings_positive"),
    )
    # One dish per slot in v1 (§6). Relaxing this for starter-plus-main later is
    # dropping one index, which is why the constraint is worth having now.
    op.create_index("uq_plan_entries_slot", "plan_entries", ["plan_id", "date", "meal"], unique=True)

    op.create_table(
        "shopping_list_items",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.func.gen_random_uuid()),
        sa.Column("plan_id", UUID(as_uuid=True), sa.ForeignKey("meal_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False, comment="As first typed — the list reads in the user's own words"),
        sa.Column("normalised_name", sa.String(length=255), nullable=False, comment="Merge key: lowercased, whitespace-collapsed, diacritics stripped"),
        sa.Column("unit", sa.String(length=50), nullable=True),
        sa.Column("total_amount", sa.Numeric(10, 3), nullable=True, comment="NULL for things with no quantity — 'sal' is a real ingredient"),
        sa.Column("is_checked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_manual", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    # THE COALESCE IS THE POINT. Indexing `unit` directly would not merge the
    # common case, because most ingredients have no unit and NULLs compare as
    # distinct. Same expression as the upsert in postgres_meal_plan_repo.py.
    op.create_index(
        "uq_shopping_list_items_merge_key",
        "shopping_list_items",
        ["plan_id", "normalised_name", sa.text("COALESCE(unit, '')")],
        unique=True,
    )

    op.create_table(
        "list_item_sources",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.func.gen_random_uuid()),
        sa.Column("item_id", UUID(as_uuid=True), sa.ForeignKey("shopping_list_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "entry_id",
            UUID(as_uuid=True),
            sa.ForeignKey("plan_entries.id", ondelete="SET NULL"),
            nullable=True,
            comment="NULL for manual extras, and once the entry is removed; dish_name survives either way",
        ),
        sa.Column("dish_name", sa.String(length=255), nullable=False, comment="Snapshot — answers 'why is there fennel on this list?' after the recipe is gone"),
        sa.Column("amount", sa.Numeric(10, 3), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_list_item_sources_item_id", "list_item_sources", ["item_id"])
    # Postgres does not auto-index FK columns, and removing an entry looks its
    # sources up by this column every time (§4.5's drift rule).
    op.create_index("ix_list_item_sources_entry_id", "list_item_sources", ["entry_id"])
    op.create_index("ix_plan_entries_plan_id", "plan_entries", ["plan_id"])
    op.create_index("ix_shopping_list_items_plan_id", "shopping_list_items", ["plan_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("list_item_sources")
    op.drop_table("shopping_list_items")
    op.drop_table("plan_entries")
    op.drop_table("meal_plans")
    MEAL_ENUM.drop(op.get_bind(), checkfirst=True)
    STATUS_ENUM.drop(op.get_bind(), checkfirst=True)
