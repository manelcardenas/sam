"""Invariants the dev fixture has to hold for the UI to be exercisable locally.

Seed data is not production data and does not need testing for its own sake. What
it does need is to *cover the states the UI renders*, because a fixture that
misses one makes a working feature look broken — which is how the "who added it"
filter spent its first afternoon invisible: every seeded recipe belonged to one
user, and a lone author chip selects the whole list, so the row correctly refused
to draw itself.

These are cheap and they fail loudly at the point the fixture regresses, rather
than the next time someone opens the app and doubts the code.
"""

from scripts.seed import DEV_USER_ID, QUICK_RECIPES, RECIPES, SEED_USER_ID


def _author(recipe: dict) -> str:
    return recipe.get("created_by", SEED_USER_ID)


class TestTheAuthorFilterHasSomethingToFilter:
    def test_the_fixture_names_more_than_one_author(self) -> None:
        """Otherwise `RecipeFilterChips` renders no author chips at all — one chip
        that selects everything is the Bebida dead end in a different costume."""
        authors = {_author(r) for r in [*RECIPES, *QUICK_RECIPES]}

        assert len(authors) > 1, "the who-added-it chips need at least two authors to render"

    def test_both_seeded_users_own_recipes(self) -> None:
        authors = {_author(r) for r in [*RECIPES, *QUICK_RECIPES]}

        assert {SEED_USER_ID, DEV_USER_ID} <= authors

    def test_the_second_author_spans_more_than_one_category(self) -> None:
        """So that category AND author can be combined without landing on an empty
        list — the combination is the thing worth checking by hand."""
        categories = {r["food_type"] for r in QUICK_RECIPES if _author(r) == DEV_USER_ID}

        assert len(categories) > 1

    def test_the_real_recipes_are_all_the_owners(self) -> None:
        """The 14 in `RECIPES` are real data, not fixture. Reattributing one to a
        made-up dev user would put words in somebody's mouth, and the reattribution
        branch in the seed loop deliberately only touches `QUICK_RECIPES`."""
        assert {_author(r) for r in RECIPES} == {SEED_USER_ID}


class TestTheCategoryChipsHaveSomethingToFilter:
    def test_the_fixture_spans_more_than_one_category(self) -> None:
        categories = {r["food_type"] for r in [*RECIPES, *QUICK_RECIPES]}

        assert len(categories) > 1
