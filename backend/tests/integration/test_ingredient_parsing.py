"""Free ingredient text becomes reviewable structured lines (plan §4).

The parser itself is faked. What is worth testing is everything *around* it —
the part that decides, as opposed to the part that guesses: that a key the
vocabulary does not hold is not trusted, that a new row is written once and
marked as unvouched-for, that a provider being down degrades instead of failing,
and that the route exists at all.
"""

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.app.use_cases import ParseIngredients
from src.domain.entities import Aisle, GroceryItem, GrocerySource, IngredientParserError, ParsedIngredients, ParsedLine, ProposedGroceryItem
from src.domain.ports import IngredientParser
from src.infra.adapters.parsing import FailoverParser
from src.infra.adapters.repos.in_memory_grocery_repo import InMemoryGroceryRepository
from src.infra.adapters.repos.in_memory_recipe_repo import InMemoryRecipeRepository
from src.infra.controllers.grocery_controller import GroceryController
from src.infra.security import get_current_user


class FakeParser(IngredientParser):
    """Returns whatever it was handed, or raises. The seam the real provider sits behind."""

    def __init__(self, result: ParsedIngredients | Exception) -> None:
        self.result = result
        self.calls: list[tuple[str, int, int]] = []

    def parse(self, text: str, vocabulary: list[GroceryItem], servings: int) -> ParsedIngredients:
        self.calls.append((text, len(vocabulary), servings))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def grocery(key: str, aisle: Aisle = Aisle.OTHER, **overrides: object) -> GroceryItem:
    defaults: dict[str, object] = {"key": key, "name_es": key.title(), "name_ca": key.title(), "name_en": key.title(), "aisle": aisle}
    return GroceryItem(**{**defaults, **overrides})  # type: ignore[arg-type]


VOCABULARY = [
    grocery("huevos", Aisle.DAIRY_EGGS),
    grocery("cebolla", Aisle.PRODUCE),
    grocery("aceite de oliva", Aisle.CONDIMENTS, is_pantry=True, default_unit="ml"),
]


@pytest.fixture
def groceries() -> InMemoryGroceryRepository:
    return InMemoryGroceryRepository(list(VOCABULARY))


def line(**overrides: object) -> ParsedLine:
    return ParsedLine(**{"raw": "x", **overrides})  # type: ignore[arg-type]


def client_for(parser: IngredientParser, groceries: InMemoryGroceryRepository) -> Iterator[TestClient]:
    from fastapi import APIRouter

    app = FastAPI()
    router = APIRouter()
    GroceryController(groceries, InMemoryRecipeRepository(), parser, router)
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: None
    with TestClient(app) as client:
        yield client


class TestTheRouteExists:
    def test_it_answers_on_the_path_the_gateway_declares(self, groceries: InMemoryGroceryRepository) -> None:
        """Registered in `__init__`, not inside another handler.

        This is not a hypothetical: the registration was once appended after a
        `return` inside `list_items`, so the route only came into being if
        somebody first fetched the vocabulary — and the gateway check cannot see
        that, because a route absent from FastAPI is absent from both sides.
        """
        parser = FakeParser(ParsedIngredients(lines=[line(raw="2 cebollas", grocery_key="cebolla", amount=2)]))

        for client in client_for(parser, groceries):
            assert client.post("/ingredients/parse", json={"text": "2 cebollas"}).status_code == 200


class TestResolving:
    def run(self, parsed: ParsedIngredients, groceries: InMemoryGroceryRepository) -> list:
        return ParseIngredients(FakeParser(parsed), groceries).execute("whatever", 4).lines

    def test_a_known_key_resolves_without_creating_anything(self, groceries: InMemoryGroceryRepository) -> None:
        lines = self.run(ParsedIngredients(lines=[line(raw="2 cebollas", grocery_key="cebolla", amount=2)]), groceries)

        assert (lines[0].item.key, lines[0].is_new, lines[0].amount) == ("cebolla", False, 2)
        assert len(groceries.list_all()) == len(VOCABULARY)

    def test_a_key_the_vocabulary_does_not_hold_is_not_trusted(self, groceries: InMemoryGroceryRepository) -> None:
        """Models occasionally echo a plausible key they invented. Falling through
        to the proposal beside it beats failing the whole block over one line."""
        parsed = ParsedIngredients(
            lines=[
                line(
                    raw="calçots",
                    grocery_key="calcots_invented",
                    proposed=ProposedGroceryItem(name_es="Calçots", name_ca="Calçots", name_en="Calçots", aisle=Aisle.PRODUCE),
                )
            ]
        )

        lines = self.run(parsed, groceries)

        assert (lines[0].item.key, lines[0].is_new) == ("calcots", True)

    def test_a_new_row_is_written_and_marked_unvouched_for(self, groceries: InMemoryGroceryRepository) -> None:
        parsed = ParsedIngredients(
            lines=[line(raw="salsa de soja", proposed=ProposedGroceryItem(name_es="Salsa de soja", name_ca="Salsa de soja", name_en="Soy sauce", aisle=Aisle.CONDIMENTS))]
        )

        self.run(parsed, groceries)

        stored = next(item for item in groceries.list_all() if item.key == "salsa de soja")
        # `source='ai' AND confirmed_at IS NULL` is the review queue. A new row
        # claiming to be seeded would hide from it for ever.
        assert (stored.source, stored.confirmed_at) == (GrocerySource.AI, None)

    def test_a_proposal_that_already_exists_reuses_the_row(self, groceries: InMemoryGroceryRepository) -> None:
        """`Huevos` proposed when `huevos` is already there is the same thing
        spelled with a capital. Creating it would split the shopping list."""
        parsed = ParsedIngredients(lines=[line(raw="Huevos", proposed=ProposedGroceryItem(name_es="Huevos", name_ca="Ous", name_en="Eggs", aisle=Aisle.DAIRY_EGGS))])

        lines = self.run(parsed, groceries)

        assert (lines[0].item.key, lines[0].is_new) == ("huevos", False)
        assert len(groceries.list_all()) == len(VOCABULARY)

    def test_a_line_with_neither_a_match_nor_a_proposal_is_dropped(self, groceries: InMemoryGroceryRepository) -> None:
        """The schema forbids it, so this is a model ignoring its own tool
        definition. Inventing an ingredient nobody typed is worse than losing a
        line the user can see is missing."""
        lines = self.run(ParsedIngredients(lines=[line(raw="???"), line(raw="2 cebollas", grocery_key="cebolla")]), groceries)

        assert [each.item.key for each in lines] == ["cebolla"]

    def test_it_keeps_the_users_own_words(self, groceries: InMemoryGroceryRepository) -> None:
        """`raw` is how you tell a misread line from a mistyped one."""
        lines = self.run(ParsedIngredients(lines=[line(raw="dos cebollas grandes", grocery_key="cebolla", amount=2)]), groceries)

        assert lines[0].raw == "dos cebollas grandes"


class TestUnits:
    def run(self, parsed: ParsedIngredients, groceries: InMemoryGroceryRepository) -> list:
        return ParseIngredients(FakeParser(parsed), groceries).execute("whatever", 4).lines

    def test_a_bare_amount_is_left_bare_rather_than_given_the_rows_unit(self, groceries: InMemoryGroceryRepository) -> None:
        """**The bug this replaced a passing test to fix.**

        The rule used to be "an amount with no unit takes the vocabulary's
        `default_unit`". Run over the real recipes it fired exactly twice and was
        wrong twice: `1 patata` became *1 g* of potato and `2 de vainilla` became
        *2 ml* of extract. It could only see that an amount existed — never
        whether the cook was counting or weighing — and a wrong unit is worse
        than none, because the shopping list merges on it.

        `default_unit` now goes to the model in the vocabulary block, where the
        raw text is also visible. Vague beats wrong.
        """
        lines = self.run(ParsedIngredients(lines=[line(raw="1 patata", grocery_key="aceite de oliva", amount=1)]), groceries)

        assert lines[0].unit is None

    def test_the_unit_the_model_read_is_passed_straight_through(self, groceries: InMemoryGroceryRepository) -> None:
        """Somebody who wrote "2 cucharadas" meant spoons, and nothing here gets
        to second-guess that."""
        lines = self.run(ParsedIngredients(lines=[line(raw="2 cucharadas de aceite", grocery_key="aceite de oliva", amount=2, unit="cucharadas")]), groceries)

        assert lines[0].unit == "cucharadas"

    def test_an_amountless_line_gets_no_unit_either(self, groceries: InMemoryGroceryRepository) -> None:
        """ "aceite" with no quantity is a real ingredient line. "ml" alone on it
        would read as a missing number rather than as no number."""
        lines = self.run(ParsedIngredients(lines=[line(raw="aceite", grocery_key="aceite de oliva")]), groceries)

        assert (lines[0].amount, lines[0].unit) == (None, None)


class TestWhatTheModelIsTold:
    """The prompt is an interface. What the vocabulary block carries decides what
    the model *can* get right, so it is worth asserting rather than assuming."""

    def test_the_block_carries_the_unit_an_item_is_sold_by(self) -> None:
        from src.infra.adapters.parsing.prompt import vocabulary_block

        assert "aceite de oliva|Aceite De Oliva|Aceite De Oliva|Aceite De Oliva|ml" in vocabulary_block(VOCABULARY)

    def test_an_item_sold_by_the_unit_carries_an_empty_field_not_the_word_none(self) -> None:
        from src.infra.adapters.parsing.prompt import vocabulary_block

        assert vocabulary_block([grocery("huevos")]).endswith("|")


class TestDidYouMean:
    def test_a_near_miss_on_a_new_row_asks_rather_than_decides(self, groceries: InMemoryGroceryRepository) -> None:
        parsed = ParsedIngredients(lines=[line(raw="huveos", proposed=ProposedGroceryItem(name_es="Huveos", name_ca="Huveos", name_en="Huveos", aisle=Aisle.DAIRY_EGGS))])

        lines = ParseIngredients(FakeParser(parsed), groceries).execute("x", 2).lines

        assert lines[0].is_new
        assert lines[0].did_you_mean == ["Huevos"]

    def test_it_never_blocks_a_genuinely_different_ingredient(self, groceries: InMemoryGroceryRepository) -> None:
        """The reason this suggests instead of forcing. `pimiento` and `pimienta`
        are one edit apart — exactly as close as `huveos` is to `huevos` — and
        merging them puts the wrong thing in the basket."""
        groceries.upsert_many([grocery("pimienta", Aisle.CONDIMENTS)])
        parsed = ParsedIngredients(
            lines=[line(raw="pimiento", proposed=ProposedGroceryItem(name_es="Pimiento", name_ca="Pebrot", name_en="Pepper", aisle=Aisle.PRODUCE))]
        )

        lines = ParseIngredients(FakeParser(parsed), groceries).execute("x", 2).lines

        assert lines[0].item.key == "pimiento"
        assert lines[0].item.aisle is Aisle.PRODUCE

    def test_an_existing_row_is_not_second_guessed(self, groceries: InMemoryGroceryRepository) -> None:
        """Asking "did you mean X?" about a row the vocabulary already holds is
        asking about a decision already made."""
        lines = ParseIngredients(FakeParser(ParsedIngredients(lines=[line(grocery_key="huevos")])), groceries).execute("x", 2).lines

        assert lines[0].did_you_mean == []


class TestFailover:
    def test_the_second_provider_answers_when_the_first_is_down(self) -> None:
        good = FakeParser(ParsedIngredients(lines=[line(grocery_key="huevos")]))
        failover = FailoverParser([FakeParser(IngredientParserError("timeout")), good])

        result = failover.parse("x", VOCABULARY, 2)

        assert len(result.lines) == 1
        assert good.calls

    def test_every_provider_failing_is_one_error_the_caller_can_act_on(self) -> None:
        failover = FailoverParser([FakeParser(IngredientParserError("timeout")), FakeParser(IngredientParserError("rate limited"))])

        with pytest.raises(IngredientParserError) as raised:
            failover.parse("x", VOCABULARY, 2)

        # Both reasons survive: the log is the only place anybody will ever see
        # which provider gave up first.
        assert "timeout" in str(raised.value)
        assert "rate limited" in str(raised.value)

    def test_the_route_answers_503_rather_than_500(self, groceries: InMemoryGroceryRepository) -> None:
        """Nothing here is broken — an external service is unreachable, and the
        client's answer is the manual fallback rather than a retry."""
        for client in client_for(FailoverParser([FakeParser(IngredientParserError("down"))]), groceries):
            assert client.post("/ingredients/parse", json={"text": "2 cebollas"}).status_code == 503


class TestTheRequest:
    def test_a_runaway_paste_is_refused_rather_than_billed(self, groceries: InMemoryGroceryRepository) -> None:
        parser = FakeParser(ParsedIngredients())

        for client in client_for(parser, groceries):
            assert client.post("/ingredients/parse", json={"text": "x" * 4001}).status_code == 422
        assert parser.calls == []

    def test_the_headcount_reaches_the_model_as_context(self, groceries: InMemoryGroceryRepository) -> None:
        """Context, not arithmetic: ADR-0001 scales at display time, so a parser
        that pre-divided would bake one headcount into the recipe for ever."""
        parser = FakeParser(ParsedIngredients())

        for client in client_for(parser, groceries):
            client.post("/ingredients/parse", json={"text": "2 cebollas", "servings": 6})

        assert parser.calls[0][2] == 6
