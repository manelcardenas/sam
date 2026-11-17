"""Weights in grams, volumes in millilitres, everything else as written (ADR-0009 §5)."""

import pytest

from src.domain.entities import ListItemSource, ShoppingListItem, canonical_unit, merge_key


@pytest.mark.parametrize(
    ("written", "expected"),
    [
        ("kg", ("g", 1000)),
        (" Kilos ", ("g", 1000)),
        ("gr", ("g", 1)),
        ("l", ("ml", 1000)),
        ("cl", ("ml", 10)),
        ("Lonchas", ("Lonchas", 1)),
        ("", (None, 1)),
        (None, (None, 1)),
    ],
)
def test_canonical_units(written: str | None, expected: tuple[str | None, float]) -> None:
    assert canonical_unit(written) == expected


def test_a_line_in_kilos_is_stored_in_grams_with_its_dishes_share() -> None:
    line = ShoppingListItem(display_name="carne", normalised_name="carne", unit="kg", total_amount=0.3, sources=[ListItemSource(dish_name="Ensalada", amount=0.3)])

    assert (line.total_amount, line.unit, line.sources[0].amount) == (300, "g", 300)


def test_kilos_and_grams_of_one_thing_share_a_merge_key() -> None:
    kilos = ShoppingListItem(display_name="carne", normalised_name="carne", unit="kg", total_amount=1)
    grams = ShoppingListItem(display_name="carne", normalised_name="carne", unit="g", total_amount=500)

    assert merge_key(kilos.display_name, kilos.unit) == merge_key(grams.display_name, grams.unit)


def test_reading_a_stored_line_back_changes_nothing() -> None:
    line = ShoppingListItem(display_name="leche", normalised_name="leche", unit="ml", total_amount=1200)

    assert (line.total_amount, line.unit) == (1200, "ml")
