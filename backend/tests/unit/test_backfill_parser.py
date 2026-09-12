"""The ingredient-line parser behind `scripts/backfill_ingredients.py`.

The script rewrites production rows in place, so the parser is the part that has
to be right: a wrong split is not a crash, it is a shopping list that quietly
says the wrong thing months later. The property that matters most is not how
much it parses — it is that **everything it is unsure about comes back None**
and gets left alone for a human.

Inputs are the real shapes in the data (meal-planner-plan.md §3): a leading
count, a glued-on metric unit, Spanish `de`, and lines that legitimately have no
quantity at all.
"""

import pytest

from scripts.backfill_ingredients import parse_amount, parse_line


class TestTheCommonCases:
    def test_a_bare_count_gets_no_invented_unit(self) -> None:
        """`"3 huevos"` is 56% of the data. Eggs are counted, not measured —
        inventing a unit called "huevos" would split them from `"2 huevos"`."""
        parsed = parse_line("3 huevos")

        assert (parsed.amount, parsed.unit, parsed.name) == (3, None, "huevos")

    def test_a_glued_metric_unit_is_separated(self) -> None:
        parsed = parse_line("200g de harina")

        assert (parsed.amount, parsed.unit, parsed.name) == (200, "g", "harina")

    def test_a_spaced_unit_with_de(self) -> None:
        parsed = parse_line("2 cucharadas de aceite")

        assert (parsed.amount, parsed.unit, parsed.name) == (2, "cucharada", "aceite")

    def test_household_units_count_as_units(self) -> None:
        parsed = parse_line("1 vaso de aceite")

        assert (parsed.amount, parsed.unit, parsed.name) == (1, "vaso", "aceite")

    @pytest.mark.parametrize(
        ("line", "expected"),
        [("1/2 cebolla", 0.5), ("1,5 l de leche", 1.5), ("1.5 kg de patatas", 1.5)],
    )
    def test_fractions_and_decimals(self, line: str, expected: float) -> None:
        assert parse_line(line).amount == expected


class TestUnitFolding:
    def test_plural_units_fold_to_the_singular_so_they_merge(self) -> None:
        """`"2 vasos"` and `"1 vaso"` have to reach the same shopping-list row.

        Safe because UNITS is a hand-enumerated table, unlike folding plural
        *names*, which the plan refuses for exactly this reason inverted.
        """
        assert parse_line("2 vasos de leche").unit == parse_line("1 vaso de leche").unit

    @pytest.mark.parametrize("line", ["500 gr de carne", "500 gramos de carne", "500g de carne"])
    def test_spellings_of_grams_converge(self, line: str) -> None:
        assert parse_line(line).unit == "g"


class TestRefusingToGuess:
    """Every case here must return None. A line left alone is one a human can
    still fix; a line mangled by a clever guess is one nobody notices."""

    @pytest.mark.parametrize("line", ["sal", "pimienta al gusto", "un chorrito de aceite", "aceite de oliva"])
    def test_lines_with_no_quantity_are_left_alone(self, line: str) -> None:
        assert parse_line(line) is None

    def test_a_number_with_nothing_after_it_is_not_an_ingredient(self) -> None:
        assert parse_line("200g") is None

    def test_an_unknown_word_after_the_number_stays_in_the_name(self) -> None:
        """`"3 huevos grandes"` must not acquire a unit called "huevos"."""
        parsed = parse_line("3 huevos grandes")

        assert (parsed.amount, parsed.unit, parsed.name) == (3, None, "huevos grandes")

    def test_a_zero_denominator_does_not_raise(self) -> None:
        assert parse_amount("1/0") is None


class TestIdempotence:
    def test_a_parsed_line_reparses_to_itself(self) -> None:
        """The script skips lines that already have amount/unit, but this pins
        the underlying property: re-running cannot peel a second quantity off a
        name that no longer starts with a digit."""
        once = parse_line("200g de harina")

        assert parse_line(once.name) is None
