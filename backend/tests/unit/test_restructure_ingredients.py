"""The Phase F backfill's decisions — `scripts/restructure_ingredients.py`.

This script rewrites production recipes in place, so what is worth pinning is
everything it **refuses** to do. The rewriting itself is the parser's work and is
tested where the parser is; the danger here is a run that quietly drops an
ingredient, invents a vocabulary row at 2am, or decides a recipe written without
a headcount feeds four.
"""

import pytest

from scripts.restructure_ingredients import ReadOnlyGroceryRepository, as_item, as_text, describe, is_structured
from src.domain.entities import Aisle, GroceryItem
from src.domain.entities.parsed_ingredient import ResolvedLine
from src.infra.adapters.repos.in_memory_grocery_repo import InMemoryGroceryRepository


def grocery(key: str, **overrides: object) -> GroceryItem:
    defaults: dict[str, object] = {"key": key, "name_es": key.title(), "name_ca": key.title(), "name_en": key.title(), "aisle": Aisle.OTHER}
    return GroceryItem(**{**defaults, **overrides})  # type: ignore[arg-type]


VOCABULARY = {item.key: item for item in [grocery("espaguetis"), grocery("sal"), grocery("cebolla")]}


class TestDecidingWhatIsAlreadyDone:
    """The idempotency test, and it runs before any API call — so re-running
    after hand-fixing the skipped handful costs nothing and touches nothing."""

    def test_a_line_with_the_amount_still_inside_the_name_is_not_done(self) -> None:
        # The exact condition Phase F exists to fix: `400g espaguetis` cannot
        # resolve to anything, which is why it has no aisle.
        assert is_structured([{"name": "400g espaguetis"}], VOCABULARY) is False

    def test_a_resolved_name_is_done_even_with_no_quantity(self) -> None:
        # `sal` is not an unfinished line. It is salt.
        assert is_structured([{"name": "sal"}], VOCABULARY) is True

    def test_one_unresolved_line_is_enough_to_redo_the_recipe(self) -> None:
        """Per-recipe, not per-line: the parser is given the whole block at once
        so it can split `"aceite, sal, pimienta"`, so the unit of work is the
        recipe."""
        assert is_structured([{"name": "sal"}, {"name": "400g espaguetis"}], VOCABULARY) is False

    def test_matching_ignores_case_and_accents(self) -> None:
        assert is_structured([{"name": "  ESPAGUETIS "}], VOCABULARY) is True

    def test_a_recipe_with_no_lines_is_not_claimed_to_be_done(self) -> None:
        # `all([])` is True, which would have made an empty recipe look finished
        # and hidden it from the report.
        assert is_structured([], VOCABULARY) is False


class TestRefusingToInventVocabulary:
    """§9.1's invariant: the backfill must create zero `grocery_items` rows.

    The seed was built partly *from* these lines, so a proposal means either the
    seed missed something real or a line is being misread. Both want a person.
    """

    def test_nothing_reaches_the_real_repository(self) -> None:
        inner = InMemoryGroceryRepository([grocery("sal")])
        wrapped = ReadOnlyGroceryRepository(inner)

        wrapped.upsert_many([grocery("calcots")])

        assert [item.key for item in inner.list_all()] == ["sal"]

    def test_the_attempt_is_kept_so_it_can_be_reported(self) -> None:
        wrapped = ReadOnlyGroceryRepository(InMemoryGroceryRepository([]))

        wrapped.upsert_many([grocery("calcots"), grocery("romesco")])

        assert [item.key for item in wrapped.refused] == ["calcots", "romesco"]

    def test_reading_still_works(self) -> None:
        """Read-only, not inert — the use case needs the vocabulary to match on."""
        wrapped = ReadOnlyGroceryRepository(InMemoryGroceryRepository([grocery("sal")]))

        assert [item.key for item in wrapped.list_all()] == ["sal"]


class TestWhatTheParserIsShown:
    """A stored line, turned back into the sentence the parser reads.

    Found on the second production run: `Magdalenas de anís` lost `250 Gr` of
    sugar because only `name` was being sent.
    """

    def test_a_plain_name_goes_through_untouched(self) -> None:
        assert as_text({"name": "400g espaguetis"}) == "400g espaguetis"

    def test_a_stored_amount_is_put_back_into_the_sentence(self) -> None:
        assert as_text({"name": "azúcar", "amount": 250, "unit": "Gr"}) == "250 Gr azúcar"

    def test_a_stored_amount_survives_without_a_unit(self) -> None:
        assert as_text({"name": "huevos", "amount": 6}) == "6 huevos"

    def test_the_name_wins_when_it_already_carries_the_number(self) -> None:
        # `{"name": "6 huevos", "amount": 6}` is one six written twice. Prepending
        # would send "6 6 huevos".
        assert as_text({"name": "6 huevos", "amount": 6}) == "6 huevos"

    def test_a_whole_amount_keeps_no_trailing_zero(self) -> None:
        assert as_text({"name": "azúcar", "amount": 250.0, "unit": "g"}) == "250 g azúcar"

    def test_a_blank_line_stays_blank_so_the_caller_can_drop_it(self) -> None:
        assert as_text({"name": "  "}) == ""


class TestWhatGetsWritten:
    def test_an_amount_and_unit_become_their_own_fields(self) -> None:
        line = ResolvedLine(raw="400g espaguetis", item=grocery("espaguetis"), amount=400, unit="g")

        assert as_item(line) == {"name": "Espaguetis", "amount": 400, "unit": "g"}

    def test_a_line_with_no_quantity_stores_no_quantity(self) -> None:
        """Absent, not null or zero. ADR-0001 treats absence as "pass through",
        and a `0` would render as a real amount on a shopping list."""
        assert as_item(ResolvedLine(raw="sal", item=grocery("sal"))) == {"name": "Sal"}

    def test_an_amount_with_no_unit_keeps_the_amount(self) -> None:
        # "2 cebollas" — two of a thing, and the thing is its own unit.
        assert as_item(ResolvedLine(raw="2 cebollas", item=grocery("cebolla"), amount=2)) == {"name": "Cebolla", "amount": 2}

    def test_the_name_becomes_the_vocabulary_spelling(self) -> None:
        """Not the raw text. Standardising the name is half the point — the
        other half is that it is now the same string across every recipe."""
        line = ResolvedLine(raw="espaguettis  n3", item=grocery("espaguetis"), amount=400, unit="g")

        assert as_item(line)["name"] == "Espaguetis"


class TestTheReviewOutput:
    """A person reads this before anything is written to production, so it has
    to show both sides — the counts are allowed to differ."""

    def test_it_shows_what_was_there_and_what_replaces_it(self) -> None:
        rendered = "\n".join(describe([{"name": "400g espaguetis"}], [{"name": "Espaguetis", "amount": 400, "unit": "g"}]))

        assert "400g espaguetis" in rendered
        assert "Espaguetis" in rendered
        assert "400 g" in rendered

    def test_one_line_becoming_three_renders_all_three(self) -> None:
        after = [{"name": "Aceite"}, {"name": "Sal"}, {"name": "Pimienta"}]

        rendered = "\n".join(describe([{"name": "aceite, sal, pimienta"}], after))

        assert all(name["name"] in rendered for name in after)

    @pytest.mark.parametrize(("amount", "shown"), [(400, "400"), (0.5, "0.5"), (1.0, "1")])
    def test_amounts_read_the_way_a_person_writes_them(self, amount: float, shown: str) -> None:
        # `1.0 g` of anything is a number that came out of a computer.
        rendered = "\n".join(describe([{"name": "x"}], [{"name": "Sal", "amount": amount, "unit": "g"}]))

        assert f"{shown} g" in rendered
