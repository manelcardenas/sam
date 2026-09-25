"""Getting a shopping-list line into the right aisle, after the fact.

A hand-typed line the vocabulary does not know lands in `Otros`. Two things can
move it, and this suite is organised around them:

1. **The model, in the background** (`POST …/classify`) — never on the way in,
   so adding stays instant (ingredient-capture-plan §6.2).
2. **A person** (`PUT …/aisle`, `PUT /grocery-items/{key}/aisle`) — which always
   outranks the model, and has to survive the seed re-running on every deploy.

The parser is faked, as in `test_ingredient_parsing.py`: what is worth testing is
what the server decides around it.
"""

from datetime import date

import pytest
from fastapi import APIRouter, FastAPI
from starlette.testclient import TestClient

from src.app.use_cases import ParseIngredients
from src.domain.entities import (
    Aisle,
    GroceryItem,
    GrocerySource,
    IngredientParserError,
    ParsedIngredients,
    ParsedLine,
    ProposedGroceryItem,
    ShoppingListItem,
)
from src.domain.ports import IngredientParser
from src.infra.adapters.repos.in_memory_grocery_repo import InMemoryGroceryRepository
from src.infra.adapters.repos.in_memory_kitchen_repo import InMemoryKitchenRepository
from src.infra.adapters.repos.in_memory_meal_plan_repo import InMemoryMealPlanRepository
from src.infra.adapters.repos.in_memory_recipe_repo import InMemoryRecipeRepository
from src.infra.adapters.repos.in_memory_user_repo import InMemoryUserRepository
from src.infra.controllers import GroceryController, KitchenController, MealPlanController
from src.infra.security import TokenPayload, get_current_user

NEL = "user-nel"
MARTINA = "user-martina"
NAMES = {NEL: "Nel", MARTINA: "Martina"}
SATURDAY = date(2026, 9, 5)


class FakeParser(IngredientParser):
    def __init__(self, result: ParsedIngredients | Exception | None = None) -> None:
        self.result = result if result is not None else ParsedIngredients()
        self.calls: list[str] = []

    def parse(self, text: str, vocabulary: list[GroceryItem], servings: int) -> ParsedIngredients:  # noqa: ARG002 — the port's signature
        self.calls.append(text)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def proposing(raw: str, name_es: str, aisle: Aisle, name_ca: str | None = None, name_en: str | None = None) -> ParsedIngredients:
    proposed = ProposedGroceryItem(name_es=name_es, name_ca=name_ca or name_es, name_en=name_en or name_es, aisle=aisle)
    return ParsedIngredients(lines=[ParsedLine(raw=raw, proposed=proposed)])


def matching(raw: str, key: str) -> ParsedIngredients:
    return ParsedIngredients(lines=[ParsedLine(raw=raw, grocery_key=key)])


def vocabulary() -> list[GroceryItem]:
    return [
        GroceryItem(key="huevos", name_es="Huevos", name_ca="Ous", name_en="Eggs", aisle=Aisle.DAIRY_EGGS, source=GrocerySource.SEED),
        GroceryItem(key="cebolla", name_es="Cebolla", name_ca="Ceba", name_en="Onion", aisle=Aisle.PRODUCE, source=GrocerySource.SEED),
    ]


@pytest.fixture
def repository() -> InMemoryMealPlanRepository:
    return InMemoryMealPlanRepository(names=NAMES)


@pytest.fixture
def kitchens() -> InMemoryKitchenRepository:
    return InMemoryKitchenRepository(names=NAMES)


@pytest.fixture
def groceries() -> InMemoryGroceryRepository:
    return InMemoryGroceryRepository(vocabulary())


def _app(
    repository: InMemoryMealPlanRepository,
    kitchens: InMemoryKitchenRepository,
    groceries: InMemoryGroceryRepository,
    parser: IngredientParser | None = None,
    caller: str = NEL,
) -> TestClient:
    users = InMemoryUserRepository()
    for user_id, name in NAMES.items():
        users.add(user_id, f"{name.lower()}@example.com", name)
    router = APIRouter()
    parser = parser or FakeParser()
    MealPlanController(repository, kitchens, groceries, parser, router)
    KitchenController(kitchens, users, router)
    GroceryController(groceries, InMemoryRecipeRepository(), parser, router)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: TokenPayload(sub=caller, email="n@example.com", exp=9999999999)
    return TestClient(app)


def _add(client: TestClient, *names: str) -> dict:
    response = client.post("/plans/items", json={"day": SATURDAY.isoformat(), "items": [{"name": name} for name in names]})
    assert response.status_code == 201, response.text
    return response.json()


def _line(plan: dict, display_name: str) -> dict:
    return next(i for i in plan["items"] if i["display_name"] == display_name)


class TestTheModelFilesItInTheBackground:
    def test_a_new_thing_becomes_an_unvouched_row_and_the_line_points_at_it(
        self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository, groceries: InMemoryGroceryRepository
    ) -> None:
        parser = FakeParser(proposing("papel de horno", "Papel de horno", Aisle.HOUSEHOLD, name_ca="Paper de forn", name_en="Baking paper"))
        client = _app(repository, kitchens, groceries, parser)
        plan = _add(client, "papel de horno")
        line = _line(plan, "papel de horno")
        assert line["grocery_key"] is None, "adding by hand must not wait for the model"

        response = client.post(f"/plans/{plan['id']}/items/{line['id']}/classify")

        assert response.status_code == 200, response.text
        assert _line(response.json(), "papel de horno")["grocery_key"] == "papel de horno"
        row = groceries.get("papel de horno")
        assert row is not None
        assert row.aisle == Aisle.HOUSEHOLD
        # Exactly like a row proposed while writing a recipe: nobody vouched for it.
        assert row.source == GrocerySource.AI
        assert row.confirmed_at is None

    def test_a_typo_merges_into_the_line_it_meant(
        self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository, groceries: InMemoryGroceryRepository
    ) -> None:
        """`huveos` is `huevos`. Filing it is not enough — there would be two egg
        lines, one of them in the right aisle under the wrong name."""
        client = _app(repository, kitchens, groceries, FakeParser(matching("huveos", "huevos")))
        client.post("/plans/items", json={"day": SATURDAY.isoformat(), "items": [{"name": "Huevos", "amount": 6}]})
        plan = client.post("/plans/items", json={"day": SATURDAY.isoformat(), "items": [{"name": "huveos", "amount": 4}]}).json()
        assert len(plan["items"]) == 2

        after = client.post(f"/plans/{plan['id']}/items/{_line(plan, 'huveos')['id']}/classify").json()

        assert len(after["items"]) == 1
        assert after["items"][0]["grocery_key"] == "huevos"
        assert after["items"][0]["total_amount"] == 10

    def test_the_quantity_typed_into_the_name_survives_being_filed(
        self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository, groceries: InMemoryGroceryRepository
    ) -> None:
        """The manual box sends a name only, so `6 huevos` has no amount. Filed,
        it renders as `Huevos` from the vocabulary — the 6 has to move into the
        amount or it disappears from the screen."""
        client = _app(repository, kitchens, groceries, FakeParser(ParsedIngredients(lines=[ParsedLine(raw="6 huevos", grocery_key="huevos", amount=6)])))
        plan = _add(client, "6 huevos")

        after = client.post(f"/plans/{plan['id']}/items/{_line(plan, '6 huevos')['id']}/classify").json()

        assert after["items"][0]["grocery_key"] == "huevos"
        assert after["items"][0]["total_amount"] == 6

    def test_two_typed_quantities_of_one_thing_add_up(
        self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository, groceries: InMemoryGroceryRepository
    ) -> None:
        parser = FakeParser()
        client = _app(repository, kitchens, groceries, parser)
        for typed, amount in (("6 huevos", 6), ("4 huveos", 4)):
            parser.result = ParsedIngredients(lines=[ParsedLine(raw=typed, grocery_key="huevos", amount=amount)])
            plan = _add(client, typed)
            plan = client.post(f"/plans/{plan['id']}/items/{_line(plan, typed)['id']}/classify").json()

        assert [(i["grocery_key"], i["total_amount"]) for i in plan["items"]] == [("huevos", 10)]

    def test_a_guess_never_overwrites_an_amount_the_line_already_has(
        self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository, groceries: InMemoryGroceryRepository
    ) -> None:
        client = _app(repository, kitchens, groceries, FakeParser(ParsedIngredients(lines=[ParsedLine(raw="huveos", grocery_key="huevos", amount=12)])))
        plan = client.post("/plans/items", json={"day": SATURDAY.isoformat(), "items": [{"name": "huveos", "amount": 3}]}).json()

        after = client.post(f"/plans/{plan['id']}/items/{_line(plan, 'huveos')['id']}/classify").json()

        assert after["items"][0]["total_amount"] == 3

    def test_gibberish_the_model_can_only_file_under_other_is_not_kept(
        self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository, groceries: InMemoryGroceryRepository
    ) -> None:
        """Nobody reviews this parse before it is written. A new row in `other`
        says nothing the line did not already say, and would autocomplete for
        everybody for ever."""
        client = _app(repository, kitchens, groceries, FakeParser(proposing("aksjhkjqew", "Aksjhkjqew", Aisle.OTHER)))
        plan = _add(client, "aksjhkjqew")

        after = client.post(f"/plans/{plan['id']}/items/{_line(plan, 'aksjhkjqew')['id']}/classify").json()

        assert groceries.get("aksjhkjqew") is None
        assert _line(after, "aksjhkjqew")["grocery_key"] is None

    def test_folding_a_fresh_line_into_a_ticked_one_unticks_it(
        self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository, groceries: InMemoryGroceryRepository
    ) -> None:
        """You already bought eggs; you just typed eggs again. That is more eggs
        to buy, not something already in the basket."""
        client = _app(repository, kitchens, groceries, FakeParser(matching("huveos", "huevos")))
        plan = _add(client, "Huevos")
        assert client.patch(f"/plans/{plan['id']}/items/{_line(plan, 'Huevos')['id']}", json={"is_checked": True}).status_code == 200
        plan = _add(client, "huveos")

        after = client.post(f"/plans/{plan['id']}/items/{_line(plan, 'huveos')['id']}/classify").json()

        assert [i["is_checked"] for i in after["items"]] == [False]

    def test_a_line_somebody_already_filed_is_left_alone(
        self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository, groceries: InMemoryGroceryRepository
    ) -> None:
        """The person's pick outranks the model's, including the race where the
        pick lands while the call is still in flight."""
        parser = FakeParser(proposing("bolsas", "Bolsas", Aisle.HOUSEHOLD))
        client = _app(repository, kitchens, groceries, parser)
        plan = _add(client, "bolsas")
        line = _line(plan, "bolsas")
        client.put(f"/plans/{plan['id']}/items/{line['id']}/aisle", json={"aisle": "bakery"})

        client.post(f"/plans/{plan['id']}/items/{line['id']}/classify")

        assert parser.calls == []
        assert groceries.get("bolsas").aisle == Aisle.BAKERY  # type: ignore[union-attr]

    def test_a_line_the_vocabulary_already_knows_costs_no_call(
        self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository, groceries: InMemoryGroceryRepository
    ) -> None:
        """A legacy line typed before its word was vocabulary. The name lookup
        answers it for free."""
        parser = FakeParser()
        client = _app(repository, kitchens, groceries, parser)
        plan = client.post("/plans/items", json={"day": SATURDAY.isoformat(), "items": [{"name": "x"}]}).json()
        # Written straight to the repository without a key, the way a line from
        # before §6.1 looks.
        repository.add_items(plan["id"], [ShoppingListItem(display_name="Ceba", normalised_name="", is_manual=True)])
        plan = client.get("/plans", params={"plan_id": plan["id"]}).json()

        after = client.post(f"/plans/{plan['id']}/items/{_line(plan, 'Ceba')['id']}/classify").json()

        assert parser.calls == []
        assert _line(after, "Ceba")["grocery_key"] == "cebolla"

    def test_one_line_that_is_really_two_things_is_left_for_a_person(
        self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository, groceries: InMemoryGroceryRepository
    ) -> None:
        split = ParsedIngredients(lines=[ParsedLine(raw="huevos", grocery_key="huevos"), ParsedLine(raw="cebolla", grocery_key="cebolla")])
        client = _app(repository, kitchens, groceries, FakeParser(split))
        plan = _add(client, "huevos y cebolla")

        after = client.post(f"/plans/{plan['id']}/items/{_line(plan, 'huevos y cebolla')['id']}/classify").json()

        assert _line(after, "huevos y cebolla")["grocery_key"] is None

    def test_a_provider_that_is_down_is_a_503_and_the_line_survives(
        self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository, groceries: InMemoryGroceryRepository
    ) -> None:
        client = _app(repository, kitchens, groceries, FakeParser(IngredientParserError("timeout")))
        plan = _add(client, "papel de horno")

        response = client.post(f"/plans/{plan['id']}/items/{_line(plan, 'papel de horno')['id']}/classify")

        assert response.status_code == 503
        assert _line(client.get("/plans", params={"plan_id": plan["id"]}).json(), "papel de horno")["grocery_key"] is None

    def test_another_kitchens_line_cannot_be_classified(
        self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository, groceries: InMemoryGroceryRepository
    ) -> None:
        plan = _add(_app(repository, kitchens, groceries), "papel de horno")
        stranger = _app(repository, kitchens, groceries, caller=MARTINA)

        response = stranger.post(f"/plans/{plan['id']}/items/{_line(plan, 'papel de horno')['id']}/classify")

        assert response.status_code == 403


class TestAPersonFilesIt:
    def test_an_unknown_line_becomes_a_confirmed_row_in_that_aisle(
        self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository, groceries: InMemoryGroceryRepository
    ) -> None:
        """So the next `bosses d'escombraries` lands in Droguería too, rather
        than in Otros again."""
        client = _app(repository, kitchens, groceries)
        plan = _add(client, "Bosses d'escombraries")

        after = client.put(f"/plans/{plan['id']}/items/{_line(plan, "Bosses d'escombraries")['id']}/aisle", json={"aisle": "household"}).json()

        assert _line(after, "Bosses d'escombraries")["grocery_key"] == "bosses d'escombraries"
        row = groceries.get("bosses d'escombraries")
        assert row is not None
        assert row.aisle == Aisle.HOUSEHOLD
        assert row.source == GrocerySource.HUMAN
        assert row.confirmed_at is not None

        # And the next time it is typed, it is filed on the way in.
        again = _add(client, "bosses d'escombraries")
        assert len(again["items"]) == 1

    def test_a_known_line_moves_its_row_and_confirms_it(
        self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository, groceries: InMemoryGroceryRepository
    ) -> None:
        client = _app(repository, kitchens, groceries)
        plan = _add(client, "Cebolla")

        client.put(f"/plans/{plan['id']}/items/{_line(plan, 'Cebolla')['id']}/aisle", json={"aisle": "frozen"})

        row = groceries.get("cebolla")
        assert row is not None
        assert row.aisle == Aisle.FROZEN
        assert row.confirmed_at is not None

    def test_a_shared_kitchen_member_can_file_lines_too(
        self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository, groceries: InMemoryGroceryRepository
    ) -> None:
        """§8.12: there is no owner. Filing a line is editing the list, which
        everybody in the kitchen does."""
        nel = _app(repository, kitchens, groceries)
        martina = _app(repository, kitchens, groceries, caller=MARTINA)
        assert nel.post("/kitchen/members", json={"user_id": MARTINA}).status_code == 201
        kitchen_id = martina.get("/kitchen").json()["invitations"][0]["kitchen_id"]
        assert martina.patch(f"/kitchen/invitations/{kitchen_id}", json={"accept": True}).status_code == 200
        plan = _add(nel, "papel de horno")

        response = martina.put(f"/plans/{plan['id']}/items/{_line(plan, 'papel de horno')['id']}/aisle", json={"aisle": "household"})

        assert response.status_code == 200, response.text

    def test_an_aisle_outside_the_eleven_is_refused(
        self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository, groceries: InMemoryGroceryRepository
    ) -> None:
        client = _app(repository, kitchens, groceries)
        plan = _add(client, "papel de horno")

        response = client.put(f"/plans/{plan['id']}/items/{_line(plan, 'papel de horno')['id']}/aisle", json={"aisle": "garden"})

        assert response.status_code == 422

    def test_a_row_can_be_moved_directly_from_the_recipe_review_table(
        self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository, groceries: InMemoryGroceryRepository
    ) -> None:
        client = _app(repository, kitchens, groceries)

        response = client.put("/grocery-items/huevos/aisle", json={"aisle": "meat_fish"})

        assert response.status_code == 200
        assert response.json()["aisle"] == "meat_fish"
        assert response.json()["confirmed_at"] is not None
        assert client.put("/grocery-items/nope/aisle", json={"aisle": "meat_fish"}).status_code == 404


class TestTheSeedDoesNotUndoAPerson:
    def test_re_seeding_keeps_a_confirmed_aisle_and_still_moves_an_unconfirmed_one(self, groceries: InMemoryGroceryRepository) -> None:
        """The seed runs on every deploy. Without this, a correction lasts until
        the next push and then silently reverts."""
        groceries.set_aisle("huevos", Aisle.MEAT_FISH)

        groceries.upsert_many(
            [
                GroceryItem(key="huevos", name_es="Huevos", name_ca="Ous", name_en="Eggs", aisle=Aisle.DAIRY_EGGS, source=GrocerySource.SEED),
                GroceryItem(key="cebolla", name_es="Cebolla", name_ca="Ceba", name_en="Onion", aisle=Aisle.CANNED, source=GrocerySource.SEED),
            ]
        )

        assert groceries.get("huevos").aisle == Aisle.MEAT_FISH  # type: ignore[union-attr]
        assert groceries.get("cebolla").aisle == Aisle.CANNED  # type: ignore[union-attr]


class TestAProposalNeverCollidesWithAnExistingName:
    def test_a_proposal_whose_catalan_name_is_a_hand_filed_row_is_that_row(self) -> None:
        """A hand-filed row carries the typed words in all three columns. A later
        proposal of `Bolsas de basura` / `Bosses d'escombraries` would otherwise
        create a second row owning the same Catalan name — and `name_index` then
        refuses to build, which breaks every shopping-list write after it."""
        filed = GroceryItem(
            key="bosses d'escombraries",
            name_es="Bosses d'escombraries",
            name_ca="Bosses d'escombraries",
            name_en="Bosses d'escombraries",
            aisle=Aisle.HOUSEHOLD,
            source=GrocerySource.HUMAN,
        )
        groceries = InMemoryGroceryRepository([*vocabulary(), filed])
        parser = FakeParser(proposing("bolsas de basura", "Bolsas de basura", Aisle.HOUSEHOLD, name_ca="Bosses d'escombraries", name_en="Bin bags"))

        lines = ParseIngredients(parser, groceries).execute("bolsas de basura", 1).lines

        assert lines[0].item.key == "bosses d'escombraries"
        assert lines[0].is_new is False
        assert groceries.get("bolsas de basura") is None
