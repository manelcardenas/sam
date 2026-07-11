"""phase 2: restaurants, cuisines, reviews

Adds the restaurant-reviews domain: a shared, community-editable Restaurant
record (any authenticated user may edit its facts — see docs/adr/0002), a
curated many-to-many Cuisine tag vocabulary, and per-user Reviews scored
0-10 in steps of 0.5 across four categories. See docs/plans/improvement-plan.md,
Phase 2, for the full design.

Revision ID: 874c491875f4
Revises: c3d2e1f50a8b
Create Date: 2026-07-05 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "874c491875f4"
down_revision: str | Sequence[str] | None = "c3d2e1f50a8b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STARTER_CUISINES = [
    "Italian",
    "Japanese",
    "Chinese",
    "Indian",
    "Mediterranean",
    "Spanish",
    "Mexican",
    "American",
    "French",
    "Thai",
    "Vegan/Vegetarian",
    "Other",
]


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "restaurants",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("address", sa.String(length=500), nullable=True),
        sa.Column("price_level", sa.Integer(), nullable=True, comment="1-4, € to €€€€ — a fact about the venue, not a review score"),
        sa.Column("latitude", sa.Float(), nullable=True, comment="Reserved for Phase 2b (Google Places); unused for now"),
        sa.Column("longitude", sa.Float(), nullable=True, comment="Reserved for Phase 2b (Google Places); unused for now"),
        sa.Column("created_by", sa.String(), nullable=False, comment="Whoever added it — informational only, does not gate writes"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("price_level BETWEEN 1 AND 4", name="ck_restaurants_price_level_range"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "cuisines",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )

    op.create_table(
        "restaurant_cuisines",
        sa.Column("restaurant_id", sa.UUID(), nullable=False),
        sa.Column("cuisine_id", sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(["restaurant_id"], ["restaurants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["cuisine_id"], ["cuisines.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("restaurant_id", "cuisine_id"),
    )

    op.create_table(
        "reviews",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("restaurant_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("location_score", sa.Numeric(3, 1), nullable=False),
        sa.Column("food_score", sa.Numeric(3, 1), nullable=False),
        sa.Column("service_score", sa.Numeric(3, 1), nullable=False),
        sa.Column("value_score", sa.Numeric(3, 1), nullable=False),
        sa.Column("comment", sa.String(length=1000), nullable=True),
        sa.Column("visited_at", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("location_score BETWEEN 0 AND 10", name="ck_reviews_location_score_range"),
        sa.CheckConstraint("food_score BETWEEN 0 AND 10", name="ck_reviews_food_score_range"),
        sa.CheckConstraint("service_score BETWEEN 0 AND 10", name="ck_reviews_service_score_range"),
        sa.CheckConstraint("value_score BETWEEN 0 AND 10", name="ck_reviews_value_score_range"),
        sa.CheckConstraint("mod(location_score * 2, 1) = 0", name="ck_reviews_location_score_step"),
        sa.CheckConstraint("mod(food_score * 2, 1) = 0", name="ck_reviews_food_score_step"),
        sa.CheckConstraint("mod(service_score * 2, 1) = 0", name="ck_reviews_service_score_step"),
        sa.CheckConstraint("mod(value_score * 2, 1) = 0", name="ck_reviews_value_score_step"),
        sa.ForeignKeyConstraint(["restaurant_id"], ["restaurants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        # No unique constraint on (restaurant_id, user_id) — revisits are allowed; see docs/plans/improvement-plan.md
    )

    # Seed the curated starter list — new cuisines are a plain data insert later, no migration needed.
    cuisines_table = sa.table("cuisines", sa.column("name", sa.String))
    op.bulk_insert(cuisines_table, [{"name": name} for name in STARTER_CUISINES])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("reviews")
    op.drop_table("restaurant_cuisines")
    op.drop_table("cuisines")
    op.drop_table("restaurants")
