"""Shared SQL score expressions.

These live here because two repositories need the *same* arithmetic and had
already drifted apart: the review repo rounded each review's overall to 1dp
before averaging (matching `Review.overall`, the computed property), while the
restaurant repo's search query averaged the unrounded expression. That only
mattered once the list could be *ordered* by rating — sorting high-to-low by a
number that differs from the one printed on the card is a visible bug.

Keep both callers on these helpers so the display value and the sort key cannot
diverge again.
"""

from sqlalchemy import Numeric, func
from sqlalchemy.sql.elements import ColumnElement

from src.infra.db import ReviewModel


def review_overall() -> ColumnElement[Numeric]:
    """One review's overall: the mean of its 4 category scores, to 1dp.

    Mirrors `Review.overall` in the domain entity — the value a user sees on a
    single review.
    """
    return func.round(
        (ReviewModel.location_score + ReviewModel.food_score + ReviewModel.service_score + ReviewModel.value_score) / 4,
        1,
    )


def restaurant_average_overall() -> ColumnElement[Numeric]:
    """A restaurant's average overall: the mean of its reviews' overalls, to 1dp.

    Rounded, so the value is exactly what the card prints. That matters for
    ordering: two restaurants both showing "8.0" must compare equal and fall
    through to the tie-break, rather than being split by hidden decimals.
    """
    return func.round(func.avg(review_overall()), 1)
