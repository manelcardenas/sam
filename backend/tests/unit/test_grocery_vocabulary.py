"""The shared grocery vocabulary — docs/plans/ingredient-capture-plan.md §3.

Covers the three things that are load-bearing and silent when broken: the aisle
sort order, the key agreeing with the shopping list's merge key, and the seed
holding no two rows that normalise to the same thing.
"""

from typing import ClassVar

import pytest

from scripts.grocery_seed_data import SEED
from scripts.seed_grocery import build_items
from src.domain.entities import (
    Aisle,
    GroceryItem,
    GrocerySource,
    aisle_order,
    key_for,
    name_index,
    near_duplicates,
    normalise_ingredient_name,
    resolve_grocery_key,
)
from src.infra.adapters.repos.in_memory_grocery_repo import InMemoryGroceryRepository


def an_item(key: str = "huevos", **overrides: object) -> GroceryItem:
    defaults: dict[str, object] = {
        "key": key,
        "name_es": "Huevos",
        "name_ca": "Ous",
        "name_en": "Eggs",
        "aisle": Aisle.DAIRY_EGGS,
    }
    return GroceryItem(**{**defaults, **overrides})  # type: ignore[arg-type]


class TestTheAisleIsARoute:
    def test_it_sorts_the_way_you_walk_the_shop(self) -> None:
        # Produce first, other last. Alphabetically this would be bakery first
        # and other in the middle, which is the bug `_MEAL_ORDER` documents.
        assert aisle_order(Aisle.PRODUCE) < aisle_order(Aisle.BAKERY)
        assert aisle_order(Aisle.MEAT_FISH) < aisle_order(Aisle.DRY_GOODS)
        assert aisle_order(Aisle.OTHER) == max(aisle_order(aisle) for aisle in Aisle)

    def test_it_is_not_alphabetical(self) -> None:
        """The mutation this catches is somebody replacing the order map with
        `sorted(Aisle)` because it looked tidier."""
        walked = sorted(Aisle, key=aisle_order)
        alphabetical = sorted(Aisle, key=lambda aisle: aisle.value)

        assert walked != alphabetical

    def test_every_aisle_has_exactly_one_position(self) -> None:
        positions = [aisle_order(aisle) for aisle in Aisle]

        assert sorted(positions) == list(range(len(Aisle)))


class TestTheKey:
    def test_it_is_the_shopping_list_merge_key(self) -> None:
        """Not merely similar — the same function.

        A vocabulary keyed differently from the way the list normalises is a
        vocabulary nothing can ever match, and it would fail silently: every
        lookup would just miss and every line would fall into `other`.
        """
        for name in ("Plátano", "  HUEVOS  ", "Aceite  de   oliva", "Calçots"):
            assert key_for(name) == normalise_ingredient_name(name)

    def test_it_folds_accents_and_case(self) -> None:
        assert key_for("Plátano") == "platano"
        assert key_for("Té") == "te"
        assert key_for("Calçots") == "calcots"


class TestTheNameShownToAReader:
    def test_it_answers_in_the_readers_language(self) -> None:
        item = an_item()

        assert item.name_for("es") == "Huevos"
        assert item.name_for("ca") == "Ous"
        assert item.name_for("en") == "Eggs"

    def test_an_unknown_locale_falls_back_to_spanish(self) -> None:
        """Spanish, not English: the seed is written in it and it is what gets
        typed. A blank row is never an acceptable render."""
        assert an_item().name_for("fr") == "Huevos"


class TestUpsert:
    def test_it_adds_rows(self) -> None:
        repo = InMemoryGroceryRepository()

        repo.upsert_many([an_item("huevos"), an_item("cebolla")])

        assert [item.key for item in repo.list_all()] == ["cebolla", "huevos"]

    def test_it_lists_in_key_order_so_the_prompt_prefix_is_stable(self) -> None:
        """The parser sends this as a cached prompt prefix (§4.3). An order that
        varied between calls would miss the cache on every request."""
        repo = InMemoryGroceryRepository()
        repo.upsert_many([an_item("zanahoria"), an_item("aceite"), an_item("manzana")])

        assert [item.key for item in repo.list_all()] == ["aceite", "manzana", "zanahoria"]

    def test_rerunning_the_seed_updates_rather_than_duplicating(self) -> None:
        repo = InMemoryGroceryRepository()
        repo.upsert_many([an_item("huevos", aisle=Aisle.OTHER)])

        repo.upsert_many([an_item("huevos", aisle=Aisle.DAIRY_EGGS)])

        assert len(repo.list_all()) == 1
        assert repo.list_all()[0].aisle is Aisle.DAIRY_EGGS

    def test_it_never_erases_a_human_confirmation(self) -> None:
        """The point of `confirmed_at`: somebody vouched for this row. Re-running
        the seed must not quietly put it back in the review queue."""
        repo = InMemoryGroceryRepository()
        repo.upsert_many([an_item("huevos")])
        repo.items["huevos"] = repo.items["huevos"].model_copy(update={"confirmed_at": "2026-09-12T10:00:00Z"})

        repo.upsert_many([an_item("huevos", aisle=Aisle.DAIRY_EGGS)])

        assert repo.list_all()[0].confirmed_at == "2026-09-12T10:00:00Z"

    def test_it_never_backdates_created_at(self) -> None:
        repo = InMemoryGroceryRepository()
        repo.upsert_many([an_item("huevos", created_at="2020-01-01T00:00:00Z")])

        repo.upsert_many([an_item("huevos", created_at="2099-01-01T00:00:00Z")])

        assert repo.list_all()[0].created_at == "2020-01-01T00:00:00Z"


class TestTheSeed:
    def test_no_two_rows_normalise_to_the_same_key(self) -> None:
        """The failure this prevents is silent: an upsert would let the second
        row overwrite the first, and a shopping list would then merge two
        unrelated ingredients into one line."""
        items = build_items()

        assert len({item.key for item in items}) == len(items)

    def test_every_aisle_has_something_in_it(self) -> None:
        """An empty aisle is either a vocabulary gap or a value that should not
        exist. `other` is the exception — it is where unrecognised things land,
        so nothing is seeded into it."""
        populated = {item.aisle for item in build_items()}

        assert populated == set(Aisle) - {Aisle.OTHER}

    def test_every_row_is_named_in_all_three_languages(self) -> None:
        """A missing name is what makes `huevos` and `eggs` fail to merge, which
        is the entire reason the row carries three of them."""
        blank = [item.key for item in build_items() if not (item.name_es and item.name_ca and item.name_en)]

        assert blank == []

    def test_every_row_is_marked_as_seeded(self) -> None:
        """`source` drives the review query. A seed row masquerading as `ai`
        would put 266 curated rows into the queue of things to check."""
        assert {item.source for item in build_items()} == {GrocerySource.SEED}

    def test_the_pantry_staples_are_marked_and_the_fresh_food_is_not(self) -> None:
        by_key = {item.key: item for item in build_items()}

        assert by_key["sal"].is_pantry
        assert by_key["aceite de oliva"].is_pantry
        assert by_key["harina"].is_pantry
        assert not by_key["huevos"].is_pantry
        assert not by_key["pechuga de pollo"].is_pantry

    def test_pantry_is_a_minority_of_the_vocabulary(self) -> None:
        """`is_pantry` starts a line unticked. If most of the shop were marked,
        the default would stop carrying information and the popup would become a
        wall of unticked rows."""
        items = build_items()
        pantry = [item for item in items if item.is_pantry]

        assert len(pantry) / len(items) < 0.2

    @pytest.mark.parametrize("aisle", sorted(SEED, key=aisle_order))
    def test_an_aisle_holds_no_duplicate_spanish_names(self, aisle: Aisle) -> None:
        names = [row[0] for row in SEED[aisle]]

        assert sorted(names) == sorted(set(names))


class TestNearDuplicates:
    """A **question** put to the person reviewing, never a decision.

    The plan originally specified a hard guard refusing to create a row within
    edit distance 2 of an existing one. These cases are why it is not: wrongly
    merging two ingredients puts the wrong thing in the basket and nobody sees
    why, while wrongly allowing a duplicate leaves a row you fix in one place.
    """

    VOCABULARY: ClassVar[list[str]] = ["huevos", "pimiento", "pimienta", "sal", "col", "espaguetis", "queso parmesano", "cebolla"]

    def test_it_catches_a_transposition(self) -> None:
        assert near_duplicates("huveos", self.VOCABULARY) == ["huevos"]

    def test_short_words_are_never_compared(self) -> None:
        """`sal` and `col` are two edits apart. A rule that paired them would ask
        whether the salt was meant to be cabbage, on every list, for ever."""
        assert near_duplicates("sal", self.VOCABULARY) == []
        assert near_duplicates("col", self.VOCABULARY) == []

    def test_a_short_word_is_not_paired_with_a_longer_one_either(self) -> None:
        """Both ends of the comparison need the floor, not just the candidates.

        `lima` and `limon` are two edits apart and both are in the seed — a lime
        is not a lemon. Four letters is simply too few for edit distance to mean
        anything, whichever side of the comparison they are on.
        """
        assert near_duplicates("lima", ["limon", "lima colada", "huevos"]) == []

    def test_a_one_edit_pair_of_real_ingredients_is_only_ever_a_question(self) -> None:
        """`pimiento` and `pimienta` are as close as `huveos` is to `huevos`, and
        they are both real. This surfaces the pair; nothing acts on it."""
        assert near_duplicates("pimiento", self.VOCABULARY) == ["pimienta"]

    def test_a_genuinely_new_ingredient_raises_nothing(self) -> None:
        assert near_duplicates("calcots", self.VOCABULARY) == []
        assert near_duplicates("queso rallado", self.VOCABULARY) == []

    def test_it_offers_at_most_a_couple(self) -> None:
        """A row with six "did you mean?" suggestions is a row nobody reads."""
        crowd = ["cebolla", "cebollas", "cebollo", "cebella", "ceballa"]

        assert len(near_duplicates("cebolln", crowd)) <= 2


class TestResolvingAWrittenName:
    """§6.1 — which vocabulary row a shopping-list line means.

    This runs on every line of every list write, hand-typed extras included, so
    a wrong answer here is one nobody reviews. §4's parser is where spelling is
    forgiven, under a model that can tell `spagetiis` from `espaguetis` without
    also deciding `queso rallado` is `queso parmesano`.
    """

    VOCABULARY: ClassVar[list[GroceryItem]] = [
        GroceryItem(key="cebolla", name_es="Cebolla", name_ca="Ceba", name_en="Onion", aisle=Aisle.PRODUCE),
        GroceryItem(key="cebolla tierna", name_es="Cebolla tierna", name_ca="Ceba tendra", name_en="Spring onion", aisle=Aisle.PRODUCE),
        GroceryItem(key="tomate triturado", name_es="Tomate triturado", name_ca="Tomàquet triturat", name_en="Crushed tomatoes", aisle=Aisle.CANNED),
    ]

    @pytest.mark.parametrize("written", ["Cebolla", "Ceba", "Onion", "cebolla", "  CEBOLLA  "])
    def test_every_language_finds_the_one_row(self, written: str) -> None:
        assert resolve_grocery_key(written, name_index(self.VOCABULARY)) == "cebolla"

    def test_diacritics_fold(self) -> None:
        assert resolve_grocery_key("tomaquet triturat", name_index(self.VOCABULARY)) == "tomate triturado"

    def test_a_prefix_is_not_a_match(self) -> None:
        """`cebolla` is a prefix of `cebolla tierna` and they are different
        onions. Prefix matching belongs to the autocomplete, where a wrong guess
        is visible and one tap from being corrected; here it silently merges two
        ingredients on a shopping list."""
        assert resolve_grocery_key("cebolla verde", name_index(self.VOCABULARY)) is None

    def test_the_longer_name_still_resolves_to_its_own_row(self) -> None:
        assert resolve_grocery_key("Ceba tendra", name_index(self.VOCABULARY)) == "cebolla tierna"

    def test_something_unknown_is_not_an_error(self) -> None:
        assert resolve_grocery_key("bolsas de basura", name_index(self.VOCABULARY)) is None

    def test_a_name_claimed_by_two_rows_refuses_to_build(self) -> None:
        """Whichever row won would depend on iteration order, and the loser's
        lines would merge into the winner — which is how you come home without
        an ingredient."""
        clashing = [
            GroceryItem(key="arroz", name_es="Arroz", name_ca="Arròs", name_en="Rice", aisle=Aisle.DRY_GOODS),
            GroceryItem(key="arroz bomba", name_es="Arroz bomba", name_ca="Arròs", name_en="Bomba rice", aisle=Aisle.DRY_GOODS),
        ]

        with pytest.raises(ValueError, match="maps to both"):
            name_index(clashing)

    def test_the_shipped_vocabulary_has_no_collisions(self) -> None:
        """The guard above is only useful if it is run against the real seed."""
        assert len(name_index(build_items())) > 0
