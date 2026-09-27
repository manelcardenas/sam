"""Unbought lines carry forward on their own; the calendar no longer closes

Revision ID: a8d2e6f4c913
Revises: c4b7f1a92d63
Create Date: 2026-09-26

Two changes that are one decision (meal-planner-plan §8.14):

- **`shopping_list_items.pending_since`**, nullable. Set when `CarryForward`
  moves an unbought line into a later week, to the week it was first meant for,
  so the list can say "pending since 13 Sep". NULL for every existing row, which
  is true: nothing has been carried this way yet.
- **Every `calendar_closed` week goes back to `planning`.** The button that put
  weeks there is gone, and so is the button that took them out — left alone,
  those weeks would have a locked calendar and no way to unlock it.

`list_closed` weeks are left as they are. Closing the list already offered their
unbought lines to the following week and a person chose which to keep, so they
stay archived, and `CarryForward` skips them rather than resurrecting the lines
somebody let go.

The `calendar_closed` label stays in `plan_status_enum`: Postgres cannot drop an
enum value without rebuilding the type, and after this no row holds it.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a8d2e6f4c913"
down_revision: str | Sequence[str] | None = "c4b7f1a92d63"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "shopping_list_items",
        sa.Column(
            "pending_since",
            sa.Date(),
            nullable=True,
            comment="week_start of the week this line was first meant for, once it has been carried forward unbought; NULL otherwise",
        ),
    )
    op.execute("UPDATE meal_plans SET status = 'planning' WHERE status = 'calendar_closed'")


def downgrade() -> None:
    # The status update is not reversed: which weeks had a closed calendar is not
    # recorded anywhere, and re-locking them would be guessing.
    op.drop_column("shopping_list_items", "pending_since")
