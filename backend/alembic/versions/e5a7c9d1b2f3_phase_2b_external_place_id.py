"""phase 2b: external place identity on restaurants

Adds `external_place_id` — the Geoapify place id copied when a Restaurant is
created from a picked Place (see docs/adr/0003, docs/plans/geoapify-places-plan.md).
NULL for manually-entered (Unmapped) Restaurants. A partial unique index makes
the picker's dedup race-proof: two users picking the same Place concurrently
can't create two rows.

Also refreshes the latitude/longitude column comments — they were reserved for
"Google Places", which ADR-0003 superseded with Geoapify — and adds the missing
index on reviews.restaurant_id (Postgres doesn't auto-index FK columns; the
reviews-by-restaurant lookup runs on every detail view and aggregate).

Revision ID: e5a7c9d1b2f3
Revises: 874c491875f4
Create Date: 2026-07-11 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5a7c9d1b2f3"
down_revision: str | Sequence[str] | None = "874c491875f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LOCATION_COMMENT = "Copied from the picked Place (Geoapify) when Mapped; NULL for Unmapped restaurants"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "restaurants",
        sa.Column(
            "external_place_id",
            sa.String(length=255),
            nullable=True,
            comment="Geoapify place id when Mapped (see docs/adr/0003); NULL for Unmapped restaurants",
        ),
    )
    op.create_index(
        "uq_restaurants_external_place_id",
        "restaurants",
        ["external_place_id"],
        unique=True,
        postgresql_where=sa.text("external_place_id IS NOT NULL"),
    )
    op.alter_column("restaurants", "latitude", comment=LOCATION_COMMENT)
    op.alter_column("restaurants", "longitude", comment=LOCATION_COMMENT)
    op.create_index("ix_reviews_restaurant_id", "reviews", ["restaurant_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_reviews_restaurant_id", table_name="reviews")
    op.drop_index("uq_restaurants_external_place_id", table_name="restaurants")
    op.drop_column("restaurants", "external_place_id")
    op.alter_column("restaurants", "latitude", comment="Reserved for Phase 2b (Google Places); unused for now")
    op.alter_column("restaurants", "longitude", comment="Reserved for Phase 2b (Google Places); unused for now")
