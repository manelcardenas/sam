"""the shared grocery vocabulary

Implements docs/plans/ingredient-capture-plan.md §3 — Phase A.

WHAT THIS IS FOR
----------------
The app has no idea what an ingredient *is*. `"3 huevos"` is a string: it cannot
be scaled, merged across languages, or sorted into the aisle you find it in.
This table gives buyable things an identity — one row per thing, five facts on
it, no quantities — which is what the natural ingredient capture, the aisle-
sorted shopping list and the pantry defaults all hang off.

WHAT IT DELIBERATELY IS NOT
---------------------------
Not a supermarket catalogue. `future-roadmap.md` item 10 defers that — SKUs,
brands, prices — and nothing here has any of them. The name `grocery_items`
rather than `ingredients` is because it holds detergent; rather than `catalogue`
because that word is already spoken for.

NO FOREIGN KEY FROM `recipes`
-----------------------------
Recipe ingredient lines resolve to this table by normalised *name*, a soft join,
and `recipes.ingredients` stays the JSONB column it already is. A hard FK from
inside JSONB is not expressible anyway, but the softness is wanted on its own
terms: merging or renaming a vocabulary row must not have to rewrite every
recipe that mentions it inside one transaction.

Revision ID: a1f4c7e930b2
Revises: c7e4b93a615d
Create Date: 2026-09-12 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a1f4c7e930b2"
down_revision: str | Sequence[str] | None = "c7e4b93a615d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    The enum labels are written out inline rather than built from a tuple, and
    that is not a style choice: `tests/unit/test_enum_columns_match_migrations.py`
    finds them by regex over this file's source, and a `sa.Enum(*LABELS, ...)`
    would slip past it unnoticed. That test exists because the ORM once emitted
    member names where a migration had created values, and every insert failed in
    production — an unguarded enum is exactly how that happens again.

    Postgres does not care about label *order*; the order you walk the shop is a
    Python-side concern, held by `domain/entities/grocery.py::Aisle` and read
    through `aisle_order`.

    **`create_type=False` is load-bearing, and its absence is what broke this
    migration the first time it ran.** A plain `sa.Enum` passed to
    `op.create_table` registers a `before_create` hook that emits `CREATE TYPE`
    with `checkfirst=False` — so creating the type up front (which we want, so a
    retry is harmless) guarantees the table creation then fails with
    `type "aisle_enum" already exists`. Turning the implicit creation off and
    doing it explicitly with `checkfirst=True` makes the whole migration
    re-runnable, which matters because a half-applied one leaves the types
    behind without advancing `alembic_version`.
    """
    aisle = postgresql.ENUM(
        "produce",
        "bakery",
        "meat_fish",
        "dairy_eggs",
        "frozen",
        "canned",
        "dry_goods",
        "condiments",
        "drinks",
        "household",
        "other",
        name="aisle_enum",
        create_type=False,
    )
    source = postgresql.ENUM("seed", "ai", "human", name="grocery_source_enum", create_type=False)
    aisle.create(op.get_bind(), checkfirst=True)
    source.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "grocery_items",
        # The normalised name IS the primary key. No surrogate id: the key is
        # what every caller already has in hand, and a second identifier would
        # only create a way for the two to disagree.
        sa.Column("key", sa.String(255), primary_key=True, comment="normalise_ingredient_name(): lowercased, whitespace-collapsed, diacritics stripped"),
        sa.Column("name_es", sa.String(255), nullable=False),
        sa.Column("name_ca", sa.String(255), nullable=False),
        sa.Column("name_en", sa.String(255), nullable=False),
        sa.Column("aisle", aisle, nullable=False, comment="Where in the shop. Declaration order is the sort order"),
        sa.Column(
            "is_pantry",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
            comment="Starts the line UNTICKED in the ingredient popup. Never hides it",
        ),
        sa.Column("default_unit", sa.String(50), nullable=True, comment="Parser hint: 'g' not 'gramos'. NULL means counted, not measured"),
        sa.Column("source", source, nullable=False, server_default="ai", comment="seed | ai | human"),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True, comment="When a person last vouched for this row"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # The review query: every guess nobody has checked. Partial, because the rows
    # it finds are a handful out of hundreds and a full index would be mostly
    # dead weight on a table that is otherwise read whole.
    op.create_index(
        "ix_grocery_items_unconfirmed",
        "grocery_items",
        ["source"],
        postgresql_where=sa.text("source = 'ai' AND confirmed_at IS NULL"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_grocery_items_unconfirmed", table_name="grocery_items")
    op.drop_table("grocery_items")
    # `checkfirst` on both halves: `create_type=False` above means the table does
    # not own these, so dropping it leaves them behind — and a downgrade run
    # twice must not fail on the second.
    postgresql.ENUM(name="aisle_enum").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="grocery_source_enum").drop(op.get_bind(), checkfirst=True)
