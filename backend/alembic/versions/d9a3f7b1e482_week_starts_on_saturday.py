"""weeks run Saturday→Friday: discard plans keyed to Mondays

The planner's week was Monday-Friday. It is now **Saturday-Friday**: you plan on
Saturday and shop on Sunday, so the planning day has to be the first day of the
week being planned rather than the last day of the one ending — and the weekend
is when most cooking actually happens, which the old grid could not hold at all.

Seven days rather than "Saturday to Saturday" inclusive. Consecutive weeks have
to tile without overlapping, or a single real dinner belongs to two plans at once
and `uq_plan_entries_slot` cannot stop it being assigned twice.

**This migration deletes every existing plan**, on the owner's explicit decision
(2026-09-11). Existing rows are keyed to Mondays, and after this change nothing
ever queries a Monday `week_start` again: those weeks would look empty, and the
planner would happily build a second plan over the top of them. Shifting each key
back to its preceding Saturday was the alternative and was considered — entries
keep their real dates and Mondays map one-to-one onto Saturdays, so it would have
been safe — but the data was early and not worth carrying.

Entries, shopping-list items, their sources and shares all disappear with their
plan through `ON DELETE CASCADE`. Recipes, users and restaurants are untouched:
nothing outside the planner's own five tables is read or written here.

**There is no way back.** The downgrade restores the column comment and nothing
else — deleted plans are gone, which is what "delete the existing plans" means.

Revision ID: d9a3f7b1e482
Revises: b7d2f4a91c65
Create Date: 2026-09-11 17:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d9a3f7b1e482"
down_revision: str | Sequence[str] | None = "b7d2f4a91c65"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SATURDAY_COMMENT = "Always a Saturday — the week runs Sat→Fri, normalised server-side so one week can't exist twice"
MONDAY_COMMENT = "Always a Monday — normalised server-side so one week can't exist twice"


def upgrade() -> None:
    """Upgrade schema."""
    # One statement is enough: plan_entries, shopping_list_items and plan_shares
    # all cascade from meal_plans, and shopping_list_item_sources cascades from
    # shopping_list_items. Spelled as a bare DELETE rather than TRUNCATE so the
    # cascade is the one the schema declares, not TRUNCATE's coarser one.
    op.execute(sa.text("DELETE FROM meal_plans"))

    op.alter_column(
        "meal_plans",
        "week_start",
        existing_type=sa.Date(),
        existing_nullable=False,
        comment=SATURDAY_COMMENT,
    )


def downgrade() -> None:
    """Downgrade schema.

    Restores the comment only. The deleted plans are not recoverable from here —
    if they matter, they come from a database backup.
    """
    op.alter_column(
        "meal_plans",
        "week_start",
        existing_type=sa.Date(),
        existing_nullable=False,
        comment=MONDAY_COMMENT,
    )
