"""Shopping lines in kg and l are stored in g and ml

Revision ID: c3f9a1d7e605
Revises: b6e2d4f8a1c3
Create Date: 2026-11-17

ADR-0009 §5: a line's weight is kept in grams and its volume in millilitres, so
500 g and 1 kg of carne merge into one line (shown as 1,5 kg). New lines are
converted as they are written (`ShoppingListItem`); this converts the old ones,
with each dish's share, so removing a dish still subtracts exactly what it added.

Checked on production before writing it: 4 lines (carne 1 kg, lentejas 1 kg,
caldo de carne 1 l, caldo de verduras 4 l), none with a twin already in g or ml
in its week — so nothing collides on the merge index.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c3f9a1d7e605"
down_revision: str | Sequence[str] | None = "b6e2d4f8a1c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UNITS = {"kg": ("g", 1000), "kilo": ("g", 1000), "kilos": ("g", 1000), "l": ("ml", 1000), "litro": ("ml", 1000), "litros": ("ml", 1000), "cl": ("ml", 10)}


def upgrade() -> None:
    for written, (base, factor) in _UNITS.items():
        op.execute(
            f"""
            UPDATE list_item_sources s SET amount = s.amount * {factor}
              FROM shopping_list_items i
             WHERE s.item_id = i.id AND lower(trim(i.unit)) = '{written}' AND s.amount IS NOT NULL
            """
        )
        op.execute(
            f"""
            UPDATE shopping_list_items
               SET total_amount = total_amount * {factor}, unit = '{base}'
             WHERE lower(trim(unit)) = '{written}'
            """
        )


def downgrade() -> None:
    """Nothing to undo: a line in grams is correct under either rule."""
