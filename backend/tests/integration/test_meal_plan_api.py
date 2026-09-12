"""The meal planner's HTTP surface, end to end through the controller.

Organised around the three things most likely to be wrong in a feature this
shape, rather than around the routes:

1. **The shopping list's merge** (§4.6) — one line per (name, unit), summed,
   with every contributing dish still named on it.
2. **The state machine** (§8.2) — what each state forbids, and that the server
   enforces it rather than trusting a client that hides its buttons.
3. **Drift** (§4.5) — the list never rewrites itself; removing a dish leaves the
   list alone unless the caller explicitly says otherwise.
"""

from datetime import date

import pytest
from fastapi import APIRouter, FastAPI
from starlette.testclient import TestClient

from src.infra.adapters.repos.in_memory_kitchen_repo import InMemoryKitchenRepository
from src.infra.adapters.repos.in_memory_meal_plan_repo import InMemoryMealPlanRepository
from src.infra.adapters.repos.in_memory_user_repo import InMemoryUserRepository
from src.infra.controllers import KitchenController, MealPlanController
from src.infra.security import TokenPayload, get_current_user

OWNER = "user-nel"
SOMEONE_ELSE = "user-martina"

# The week of Saturday 5 September 2026, which runs Sat 5 → Fri 11.
SATURDAY = date(2026, 9, 5)
WEDNESDAY = date(2026, 9, 9)


# One table of people, used to build both fakes. The SQL adapter reads a guest's
# name off a joined `users` row; the in-memory one has no users table, so it is
# handed the same mapping the user repository is built from. Two sources here
# would let a test pass against a repository that never resolves a name.
NAMES = {OWNER: "Nel", SOMEONE_ELSE: "Martina"}


@pytest.fixture
def repository() -> InMemoryMealPlanRepository:
    return InMemoryMealPlanRepository(names=NAMES)


@pytest.fixture
def kitchens() -> InMemoryKitchenRepository:
    """One kitchen store per test, shared by every client the test builds.

    This is what makes "two people in one kitchen" testable at all: two clients
    over two *different* stores would each get their own household and pass every
    isolation test for the wrong reason.
    """
    return InMemoryKitchenRepository(names=NAMES)


def _users() -> InMemoryUserRepository:
    users = InMemoryUserRepository()
    for user_id, name in NAMES.items():
        users.add(user_id, f"{name.lower()}@example.com", name)
    return users


def _app(
    repository: InMemoryMealPlanRepository,
    kitchens: InMemoryKitchenRepository,
    caller: str = OWNER,
    users: InMemoryUserRepository | None = None,
) -> TestClient:
    router = APIRouter()
    MealPlanController(repository, kitchens, router)
    KitchenController(kitchens, users or _users(), router)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: TokenPayload(sub=caller, email="n@example.com", exp=9999999999)
    return TestClient(app)


@pytest.fixture
def client(repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> TestClient:
    return _app(repository, kitchens)


def _share_a_kitchen(repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> tuple[TestClient, TestClient]:
    """Nel invites Martina and she accepts. Returns both clients.

    The setup almost every test below wants, because the interesting assertions
    are about what happens *after* two people share one week — and the invitation
    dance itself is tested once, in `TestTheKitchen`.
    """
    nel = _app(repository, kitchens)
    martina = _app(repository, kitchens, caller=SOMEONE_ELSE)
    assert nel.post("/kitchen/members", json={"user_id": SOMEONE_ELSE}).status_code == 201
    kitchen_id = martina.get("/kitchen").json()["invitations"][0]["kitchen_id"]
    assert martina.patch(f"/kitchen/invitations/{kitchen_id}", json={"accept": True}).status_code == 200
    return nel, martina


def _assign(client: TestClient, *, day: date = SATURDAY, meal: str = "dinner", name: str = "Lentejas", servings: int = 4) -> dict:
    response = client.put("/plans/entries", json={"date": day.isoformat(), "meal": meal, "dish_name": name, "servings": servings})
    assert response.status_code == 200, response.text
    return response.json()


def _entry(plan: dict, name: str) -> dict:
    return next(e for e in plan["entries"] if e["dish_name"] == name)


def _item(plan: dict, name: str) -> dict:
    return next(i for i in plan["items"] if i["display_name"] == name)


class TestTheWeekView:
    def test_an_unplanned_week_is_null_not_a_404(self, client: TestClient) -> None:
        """Most weeks have no plan. The planner opens on an empty calendar, and
        an error response would make that look like a failure."""
        response = client.get("/plans", params={"day": SATURDAY.isoformat()})

        assert response.status_code == 200
        assert response.json() is None

    def test_the_plan_is_created_lazily_on_the_first_assignment(self, client: TestClient) -> None:
        """An empty row for every week somebody merely looked at would fill the
        archive with weeks nobody planned."""
        _assign(client)

        assert client.get("/plans", params={"day": SATURDAY.isoformat()}).json() is not None

    @pytest.mark.parametrize("day", [SATURDAY, date(2026, 9, 6), WEDNESDAY, date(2026, 9, 11)])
    def test_any_day_of_the_week_finds_the_same_plan(self, client: TestClient, day: date) -> None:
        _assign(client)

        plan = client.get("/plans", params={"day": day.isoformat()}).json()

        assert plan["week_start"] == SATURDAY.isoformat()

    def test_a_plan_is_not_visible_to_anyone_else(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        _assign(_app(repository, kitchens))

        assert _app(repository, kitchens, caller=SOMEONE_ELSE).get("/plans", params={"day": SATURDAY.isoformat()}).json() is None


class TestAskingForAWeek:
    """`GET /plans` takes a day *or* a plan id, and exactly one of them.

    One route rather than two because `/plans/{plan_id}` would sit beside the
    literal `/plans/archive` on an API Gateway that matches exactly — the hazard
    the stack file names. So the choice moves into a query parameter, and the
    server refuses the ambiguous shapes rather than picking one.
    """

    def test_neither_is_refused(self, client: TestClient) -> None:
        assert client.get("/plans").status_code == 422

    def test_both_at_once_is_refused(self, client: TestClient) -> None:
        plan = _assign(client)

        assert client.get("/plans", params={"day": SATURDAY.isoformat(), "plan_id": plan["id"]}).status_code == 422

    def test_a_week_by_id_is_the_same_week(self, client: TestClient) -> None:
        plan = _assign(client)

        assert client.get("/plans", params={"plan_id": plan["id"]}).json()["id"] == plan["id"]

    def test_a_missing_id_is_a_404(self, client: TestClient) -> None:
        assert client.get("/plans", params={"plan_id": "00000000-0000-0000-0000-000000000000"}).status_code == 404


class TestAssigningDishes:
    def test_the_slot_is_the_identity_so_reassigning_replaces(self, client: TestClient) -> None:
        """One dish per slot in v1 (§6). Assigning Wednesday dinner twice means
        changing your mind, not creating a second Wednesday dinner."""
        _assign(client, name="Lentejas")
        plan = _assign(client, name="Tortilla")

        assert [e["dish_name"] for e in plan["entries"]] == ["Tortilla"]

    def test_lunch_and_dinner_are_different_slots(self, client: TestClient) -> None:
        _assign(client, meal="lunch", name="Ensalada")
        plan = _assign(client, meal="dinner", name="Lentejas")

        assert len(plan["entries"]) == 2

    def test_a_date_in_another_week_gets_that_weeks_plan(self, client: TestClient) -> None:
        """The week is derived from the entry's date, never passed alongside it.

        So planning ahead is not a special case and cannot put an entry in a
        week that does not contain it — it simply creates the other week's plan.
        """
        first = _assign(client)

        # A Monday two weeks out — deliberately not a week start, so this also
        # pins that the server normalises rather than storing what it was sent.
        second = client.put("/plans/entries", json={"date": "2026-09-21", "meal": "dinner", "dish_name": "Paella", "servings": 2}).json()

        assert second["week_start"] == "2026-09-19"
        assert second["id"] != first["id"]
        assert [e["dish_name"] for e in second["entries"]] == ["Paella"]

    def test_servings_must_be_at_least_one(self, client: TestClient) -> None:
        response = client.put("/plans/entries", json={"date": SATURDAY.isoformat(), "meal": "lunch", "dish_name": "x", "servings": 0})

        assert response.status_code == 422

    def test_entries_come_back_in_chronological_order(self, client: TestClient) -> None:
        _assign(client, day=WEDNESDAY, meal="dinner", name="Third")
        _assign(client, day=SATURDAY, meal="dinner", name="Second")
        plan = _assign(client, day=SATURDAY, meal="lunch", name="First")

        assert [e["dish_name"] for e in plan["entries"]] == ["First", "Second", "Third"]


class TestTheShoppingList:
    """§4.6 — a merged total is what you need at the shelf, and provenance is
    what answers "why is there fennel on this list?"."""

    def _plan_with_two_dishes(self, client: TestClient) -> dict:
        plan = _assign(client, day=SATURDAY, name="Tortilla")
        plan = _assign(client, day=WEDNESDAY, name="Lentejas")
        return plan

    def test_two_dishes_needing_onions_produce_one_line(self, client: TestClient) -> None:
        plan = self._plan_with_two_dishes(client)
        tortilla, lentejas = _entry(plan, "Tortilla"), _entry(plan, "Lentejas")

        client.post(f"/plans/{plan['id']}/items", json={"entry_id": tortilla["id"], "dish_name": "Tortilla", "items": [{"name": "cebolla", "amount": 1}]})
        response = client.post(
            f"/plans/{plan['id']}/items",
            json={"entry_id": lentejas["id"], "dish_name": "Lentejas", "items": [{"name": "Cebolla", "amount": 2}]},
        )

        items = response.json()["items"]
        assert len(items) == 1
        assert items[0]["total_amount"] == 3

    def test_the_line_keeps_every_dish_that_contributed(self, client: TestClient) -> None:
        plan = self._plan_with_two_dishes(client)
        tortilla, lentejas = _entry(plan, "Tortilla"), _entry(plan, "Lentejas")

        client.post(f"/plans/{plan['id']}/items", json={"entry_id": tortilla["id"], "dish_name": "Tortilla", "items": [{"name": "cebolla", "amount": 1}]})
        response = client.post(
            f"/plans/{plan['id']}/items",
            json={"entry_id": lentejas["id"], "dish_name": "Lentejas", "items": [{"name": "cebolla", "amount": 2}]},
        )

        sources = response.json()["items"][0]["sources"]
        assert [(s["dish_name"], s["amount"]) for s in sources] == [("Tortilla", 1), ("Lentejas", 2)]

    def test_the_first_spelling_is_the_one_shown(self, client: TestClient) -> None:
        """The list reads in the user's own words, not in normalised form."""
        plan = self._plan_with_two_dishes(client)
        tortilla, lentejas = _entry(plan, "Tortilla"), _entry(plan, "Lentejas")

        client.post(f"/plans/{plan['id']}/items", json={"entry_id": tortilla["id"], "dish_name": "Tortilla", "items": [{"name": "Plátano", "amount": 1}]})
        response = client.post(
            f"/plans/{plan['id']}/items",
            json={"entry_id": lentejas["id"], "dish_name": "Lentejas", "items": [{"name": "platano", "amount": 1}]},
        )

        assert [i["display_name"] for i in response.json()["items"]] == ["Plátano"]

    def test_the_same_ingredient_in_two_units_stays_two_lines(self, client: TestClient) -> None:
        """No unit conversion, ever (§3). Slightly untidy; never wrong."""
        plan = self._plan_with_two_dishes(client)
        tortilla, lentejas = _entry(plan, "Tortilla"), _entry(plan, "Lentejas")

        client.post(
            f"/plans/{plan['id']}/items",
            json={"entry_id": tortilla["id"], "dish_name": "Tortilla", "items": [{"name": "aceite", "amount": 200, "unit": "ml"}]},
        )
        response = client.post(
            f"/plans/{plan['id']}/items",
            json={"entry_id": lentejas["id"], "dish_name": "Lentejas", "items": [{"name": "aceite", "amount": 2, "unit": "cucharada"}]},
        )

        assert len(response.json()["items"]) == 2

    def test_an_ingredient_with_no_quantity_keeps_no_quantity(self, client: TestClient) -> None:
        """ "sal" is a real ingredient that legitimately has no amount. None must
        not become 0, which would render as "0 sal"."""
        plan = self._plan_with_two_dishes(client)
        tortilla = _entry(plan, "Tortilla")

        response = client.post(f"/plans/{plan['id']}/items", json={"entry_id": tortilla["id"], "dish_name": "Tortilla", "items": [{"name": "sal"}]})

        assert _item(response.json(), "sal")["total_amount"] is None

    def test_a_measured_line_added_to_an_unmeasured_one_adopts_the_measurement(self, client: TestClient) -> None:
        """None is not zero. Summing against a fictional 0 happens to give the
        right number here, but treating absence as a quantity is how "sal" ends
        up with one."""
        plan = self._plan_with_two_dishes(client)
        tortilla, lentejas = _entry(plan, "Tortilla"), _entry(plan, "Lentejas")

        client.post(f"/plans/{plan['id']}/items", json={"entry_id": tortilla["id"], "dish_name": "Tortilla", "items": [{"name": "sal"}]})
        response = client.post(
            f"/plans/{plan['id']}/items",
            json={"entry_id": lentejas["id"], "dish_name": "Lentejas", "items": [{"name": "sal", "amount": 5, "unit": None}]},
        )

        assert _item(response.json(), "sal")["total_amount"] == 5

    def test_two_unmeasured_lines_stay_unmeasured(self, client: TestClient) -> None:
        """The case that separates "None" from "0".

        Both dishes want salt and neither says how much. Treating the absence as
        zero sums to 0 and the line renders as "0 sal" — a quantity the user
        never gave, on a list they are reading in a shop.
        """
        plan = self._plan_with_two_dishes(client)
        tortilla, lentejas = _entry(plan, "Tortilla"), _entry(plan, "Lentejas")

        client.post(f"/plans/{plan['id']}/items", json={"entry_id": tortilla["id"], "dish_name": "Tortilla", "items": [{"name": "sal"}]})
        response = client.post(f"/plans/{plan['id']}/items", json={"entry_id": lentejas["id"], "dish_name": "Lentejas", "items": [{"name": "sal"}]})

        line = _item(response.json(), "sal")
        assert line["total_amount"] is None
        assert len(line["sources"]) == 2, "both dishes are still recorded even with no quantity between them"

    def test_a_manual_extra_needs_no_dish(self, client: TestClient) -> None:
        """Fruit, yoghurt, the things no dish implies (§2)."""
        plan = self._plan_with_two_dishes(client)

        response = client.post(f"/plans/{plan['id']}/items", json={"items": [{"name": "yogur", "amount": 6}]})

        assert response.status_code == 201
        assert _item(response.json(), "yogur")["is_manual"] is True

    def test_attribution_is_all_or_nothing(self, client: TestClient) -> None:
        """A source with no dish name renders an empty breakdown row, which
        reads as a bug rather than as a manual extra."""
        plan = self._plan_with_two_dishes(client)
        tortilla = _entry(plan, "Tortilla")

        response = client.post(f"/plans/{plan['id']}/items", json={"entry_id": tortilla["id"], "items": [{"name": "cebolla"}]})

        assert response.status_code == 422

    def test_ticking_a_line(self, client: TestClient) -> None:
        plan = self._plan_with_two_dishes(client)
        plan = client.post(f"/plans/{plan['id']}/items", json={"items": [{"name": "yogur"}]}).json()
        item = _item(plan, "yogur")

        response = client.patch(f"/plans/{plan['id']}/items/{item['id']}", json={"is_checked": True})

        assert response.status_code == 200
        assert response.json()["is_checked"] is True

    def test_a_line_from_another_plan_cannot_be_ticked_by_guessing_its_id(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        mine = _app(repository, kitchens)
        plan = _assign(mine)
        plan = mine.post(f"/plans/{plan['id']}/items", json={"items": [{"name": "yogur"}]}).json()
        item = _item(plan, "yogur")

        theirs = _app(repository, kitchens, caller=SOMEONE_ELSE)
        response = theirs.patch(f"/plans/{plan['id']}/items/{item['id']}", json={"is_checked": True})

        assert response.status_code == 403


class TestDrift:
    """§4.5 — a list that rewrites itself while you are holding it in the shop is
    worse than one that asks."""

    def _planned_and_listed(self, client: TestClient) -> tuple[dict, dict]:
        plan = _assign(client, name="Tortilla")
        entry = _entry(plan, "Tortilla")
        plan = client.post(
            f"/plans/{plan['id']}/items",
            json={"entry_id": entry["id"], "dish_name": "Tortilla", "items": [{"name": "cebolla", "amount": 1}, {"name": "huevos", "amount": 6}]},
        ).json()
        return plan, entry

    def test_removing_a_dish_leaves_the_list_alone_by_default(self, client: TestClient) -> None:
        plan, entry = self._planned_and_listed(client)

        response = client.delete(f"/plans/{plan['id']}/entries/{entry['id']}")

        assert response.json()["entries"] == []
        assert len(response.json()["items"]) == 2

    def test_removing_a_dish_can_unpick_its_lines_when_asked(self, client: TestClient) -> None:
        plan, entry = self._planned_and_listed(client)

        response = client.delete(f"/plans/{plan['id']}/entries/{entry['id']}", params={"drop_from_list": "true"})

        assert response.json()["items"] == []

    def test_unpicking_leaves_lines_other_dishes_still_need(self, client: TestClient) -> None:
        plan, tortilla = self._planned_and_listed(client)
        plan = _assign(client, day=WEDNESDAY, name="Lentejas")
        lentejas = _entry(plan, "Lentejas")
        client.post(f"/plans/{plan['id']}/items", json={"entry_id": lentejas["id"], "dish_name": "Lentejas", "items": [{"name": "cebolla", "amount": 2}]})

        response = client.delete(f"/plans/{plan['id']}/entries/{tortilla['id']}", params={"drop_from_list": "true"})

        remaining = response.json()["items"]
        assert [i["display_name"] for i in remaining] == ["cebolla"]
        assert remaining[0]["total_amount"] == 2, "only the removed dish's share comes off"
        assert [s["dish_name"] for s in remaining[0]["sources"]] == ["Lentejas"]

    def test_unpicking_never_leaves_a_negative_quantity(self, client: TestClient) -> None:
        """The arithmetic can drift if a line was edited by hand, and a negative
        quantity on a shopping list is nonsense rather than information."""
        plan, entry = self._planned_and_listed(client)
        item = _item(plan, "cebolla")
        client.delete(f"/plans/{plan['id']}/items/{item['id']}")
        client.post(f"/plans/{plan['id']}/items", json={"items": [{"name": "cebolla", "amount": 0}]})

        response = client.delete(f"/plans/{plan['id']}/entries/{entry['id']}", params={"drop_from_list": "true"})

        assert all(i["total_amount"] is None or i["total_amount"] >= 0 for i in response.json()["items"])

    def test_a_hand_added_extra_survives_unpicking(self, client: TestClient) -> None:
        """You put it there, not the dish."""
        plan, entry = self._planned_and_listed(client)
        client.post(f"/plans/{plan['id']}/items", json={"items": [{"name": "yogur"}]})

        response = client.delete(f"/plans/{plan['id']}/entries/{entry['id']}", params={"drop_from_list": "true"})

        assert [i["display_name"] for i in response.json()["items"]] == ["yogur"]


class TestTheStateMachineOverHttp:
    def _plan(self, client: TestClient) -> dict:
        return _assign(client)

    def test_closing_the_calendar_then_the_list(self, client: TestClient) -> None:
        plan = self._plan(client)

        closed = client.post(f"/plans/{plan['id']}/status", json={"from_status": "planning"})
        assert closed.json()["status"] == "calendar_closed"

        archived = client.post(f"/plans/{plan['id']}/status", json={"from_status": "calendar_closed"})
        assert archived.json()["status"] == "list_closed"

    def test_a_closed_calendar_refuses_new_dishes_with_409_not_403(self, client: TestClient) -> None:
        """409 means "not now", 403 means "not yours". A client that cannot tell
        them apart tells the user they lack permission to edit their own plan."""
        plan = self._plan(client)
        client.post(f"/plans/{plan['id']}/status", json={"from_status": "planning"})

        response = client.put("/plans/entries", json={"date": SATURDAY.isoformat(), "meal": "lunch", "dish_name": "Paella", "servings": 2})

        assert response.status_code == 409

    def test_a_closed_calendar_still_takes_manual_extras(self, client: TestClient) -> None:
        """This is the shopping state — the fruit goes on during the walk out."""
        plan = self._plan(client)
        client.post(f"/plans/{plan['id']}/status", json={"from_status": "planning"})

        assert client.post(f"/plans/{plan['id']}/items", json={"items": [{"name": "fruta"}]}).status_code == 201

    def test_a_closed_calendar_still_takes_ticks(self, client: TestClient) -> None:
        plan = self._plan(client)
        plan = client.post(f"/plans/{plan['id']}/items", json={"items": [{"name": "fruta"}]}).json()
        client.post(f"/plans/{plan['id']}/status", json={"from_status": "planning"})
        item = _item(plan, "fruta")

        assert client.patch(f"/plans/{plan['id']}/items/{item['id']}", json={"is_checked": True}).status_code == 200

    def test_a_closed_list_refuses_ticks(self, client: TestClient) -> None:
        plan = self._plan(client)
        plan = client.post(f"/plans/{plan['id']}/items", json={"items": [{"name": "fruta"}]}).json()
        item = _item(plan, "fruta")
        client.post(f"/plans/{plan['id']}/status", json={"from_status": "planning"})
        client.post(f"/plans/{plan['id']}/status", json={"from_status": "calendar_closed"})

        assert client.patch(f"/plans/{plan['id']}/items/{item['id']}", json={"is_checked": True}).status_code == 409

    def test_a_stale_transition_is_rejected_rather_than_double_advancing(self, client: TestClient) -> None:
        """Two taps on a slow connection must not close the calendar *and* the
        list — which is unrecoverable in v1, where transitions are one-way."""
        plan = self._plan(client)
        client.post(f"/plans/{plan['id']}/status", json={"from_status": "planning"})

        response = client.post(f"/plans/{plan['id']}/status", json={"from_status": "planning"})

        assert response.status_code == 409
        assert client.get("/plans", params={"day": SATURDAY.isoformat()}).json()["status"] == "calendar_closed"

    def test_a_closed_plan_has_nowhere_left_to_go(self, client: TestClient) -> None:
        plan = self._plan(client)
        client.post(f"/plans/{plan['id']}/status", json={"from_status": "planning"})
        client.post(f"/plans/{plan['id']}/status", json={"from_status": "calendar_closed"})

        assert client.post(f"/plans/{plan['id']}/status", json={"from_status": "calendar_closed"}).status_code == 409

    def test_the_server_enforces_the_machine_even_though_the_ui_hides_the_buttons(self, client: TestClient) -> None:
        """A client that hides a button is not a guard: a stale tab, a second
        device or a replayed request all arrive with the UI's opinion out of
        date."""
        plan = self._plan(client)
        entry = _entry(plan, "Lentejas")
        client.post(f"/plans/{plan['id']}/status", json={"from_status": "planning"})

        assert client.delete(f"/plans/{plan['id']}/entries/{entry['id']}").status_code == 409


class TestOwnership:
    def test_someone_elses_plan_cannot_be_written_to(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        plan = _assign(_app(repository, kitchens))
        entry = _entry(plan, "Lentejas")

        theirs = _app(repository, kitchens, caller=SOMEONE_ELSE)

        assert theirs.delete(f"/plans/{plan['id']}/entries/{entry['id']}").status_code == 403
        assert theirs.post(f"/plans/{plan['id']}/items", json={"items": [{"name": "x"}]}).status_code == 403
        assert theirs.post(f"/plans/{plan['id']}/status", json={"from_status": "planning"}).status_code == 403

    def test_a_missing_plan_is_a_404(self, client: TestClient) -> None:
        missing = "00000000-0000-0000-0000-000000000000"

        assert client.post(f"/plans/{missing}/status", json={"from_status": "planning"}).status_code == 404


class TestTheKitchen:
    """Two people, one week (§8.12).

    The feature replaced sharing, and the tests that matter most are the ones
    that would have *failed* under sharing: Martina moving Wednesday's dinner,
    Martina adding to the list, Martina closing the week. A shared planner where
    one person is quietly less able than the other is the exact problem this was
    built to remove, and it is invisible until somebody tries.
    """

    def test_everybody_has_a_kitchen_without_asking_for_one(self, client: TestClient) -> None:
        """Living alone is a household too. There is no "not in a kitchen yet"
        state for the rest of the app to branch on."""
        view = client.get("/kitchen").json()

        assert [m["display_name"] for m in view["kitchen"]["members"]] == ["Nel"]
        assert view["invitations"] == []

    def test_the_same_kitchen_comes_back_every_time(self, client: TestClient) -> None:
        """Lazy creation that ran twice would put somebody in a fresh household
        on every page load, taking their week with it."""
        first = client.get("/kitchen").json()["kitchen"]["id"]

        assert client.get("/kitchen").json()["kitchen"]["id"] == first

    def test_an_invitation_waits_to_be_answered(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        """Joining is a *move* — she leaves her own kitchen — so it cannot happen
        because somebody typed her name."""
        nel = _app(repository, kitchens)
        nel.post("/kitchen/members", json={"user_id": SOMEONE_ELSE})

        martina = _app(repository, kitchens, caller=SOMEONE_ELSE)
        view = martina.get("/kitchen").json()

        assert [m["display_name"] for m in view["kitchen"]["members"]] == ["Martina"], "still in her own"
        assert [i["invited_by_name"] for i in view["invitations"]] == ["Nel"]

    def test_an_invitation_grants_nothing_until_it_is_answered(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        """Pending is not membership. If it were, inviting somebody would hand
        them the week before they agreed to anything."""
        nel = _app(repository, kitchens)
        plan = _assign(nel)
        nel.post("/kitchen/members", json={"user_id": SOMEONE_ELSE})

        martina = _app(repository, kitchens, caller=SOMEONE_ELSE)

        assert martina.get("/plans", params={"day": SATURDAY.isoformat()}).json() is None
        assert martina.get("/plans/archive", params={"year": 2026}).json() == []
        assert martina.get("/plans", params={"plan_id": plan["id"]}).status_code == 403

    def test_an_invitation_names_who_is_already_in_it(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        """The honest question to answer before accepting is whose kitchen it
        is, not only who sent the invitation."""
        _app(repository, kitchens).post("/kitchen/members", json={"user_id": SOMEONE_ELSE})

        invite = _app(repository, kitchens, caller=SOMEONE_ELSE).get("/kitchen").json()["invitations"][0]

        assert [m["display_name"] for m in invite["members"]] == ["Nel"]

    def test_accepting_puts_both_of_them_in_one_kitchen(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        nel, martina = _share_a_kitchen(repository, kitchens)

        assert nel.get("/kitchen").json()["kitchen"]["id"] == martina.get("/kitchen").json()["kitchen"]["id"]
        assert [m["display_name"] for m in nel.get("/kitchen").json()["kitchen"]["members"]] == ["Martina", "Nel"]

    def test_accepting_leaves_the_kitchen_she_was_in(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        """One active kitchen per person. Two would mean two answers to "which
        week am I planning?", and the planner would have to pick."""
        before = _app(repository, kitchens, caller=SOMEONE_ELSE).get("/kitchen").json()["kitchen"]["id"]
        _, martina = _share_a_kitchen(repository, kitchens)

        assert martina.get("/kitchen").json()["kitchen"]["id"] != before

    def test_declining_leaves_everything_where_it_was(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        nel = _app(repository, kitchens)
        martina = _app(repository, kitchens, caller=SOMEONE_ELSE)
        hers = martina.get("/kitchen").json()["kitchen"]["id"]
        nel.post("/kitchen/members", json={"user_id": SOMEONE_ELSE})
        theirs = martina.get("/kitchen").json()["invitations"][0]["kitchen_id"]

        after = martina.patch(f"/kitchen/invitations/{theirs}", json={"accept": False}).json()

        assert after["kitchen"]["id"] == hers
        assert after["invitations"] == []
        assert nel.get("/kitchen").json()["kitchen"]["pending"] == []

    def test_the_week_is_the_same_week_for_both_of_them(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        """The whole point. Under sharing these were two plans and two lists."""
        nel, martina = _share_a_kitchen(repository, kitchens)
        planned = _assign(nel)

        assert martina.get("/plans", params={"day": SATURDAY.isoformat()}).json()["id"] == planned["id"]

    def test_she_can_move_wednesdays_dinner(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        """The single most important test in this file: it is exactly what
        read-and-tick sharing forbade."""
        nel, martina = _share_a_kitchen(repository, kitchens)
        plan = _assign(nel)
        entry = _entry(plan, "Lentejas")

        assert martina.delete(f"/plans/{plan['id']}/entries/{entry['id']}").status_code == 200
        assert _assign(martina, name="Tortilla")["entries"][0]["dish_name"] == "Tortilla"

    def test_she_can_add_to_the_list_tick_it_and_close_the_week(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        nel, martina = _share_a_kitchen(repository, kitchens)
        plan = _assign(nel)

        plan = martina.post(f"/plans/{plan['id']}/items", json={"items": [{"name": "yogur"}]}).json()
        item = _item(plan, "yogur")

        assert martina.patch(f"/plans/{plan['id']}/items/{item['id']}", json={"is_checked": True}).status_code == 200
        assert martina.post(f"/plans/{plan['id']}/status", json={"from_status": "planning"}).status_code == 200

    def test_her_list_line_says_it_was_hers(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        """Attribution, not permission. Either of them can remove it; only one of
        them put it there, and a shared list cannot say so without this."""
        nel, martina = _share_a_kitchen(repository, kitchens)
        _assign(nel)
        martina.post("/plans/items", json={"day": SATURDAY.isoformat(), "items": [{"name": "azucar"}]})

        plan = nel.get("/plans", params={"day": SATURDAY.isoformat()}).json()

        assert _item(plan, "azucar")["created_by_name"] == "Martina"

    def test_her_dish_says_it_was_hers(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        nel, martina = _share_a_kitchen(repository, kitchens)
        _assign(nel, meal="lunch", name="Ensalada")
        _assign(martina, meal="dinner", name="Lentejas")

        plan = nel.get("/plans", params={"day": SATURDAY.isoformat()}).json()

        assert {e["dish_name"]: e["created_by_name"] for e in plan["entries"]} == {"Ensalada": "Nel", "Lentejas": "Martina"}

    def test_reassigning_a_slot_moves_the_attribution_too(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        """The slot is the identity, so whoever set what is in it now is whose it
        is. Keeping the first name would credit her with his dish."""
        nel, martina = _share_a_kitchen(repository, kitchens)
        _assign(nel, name="Lentejas")

        assert _assign(martina, name="Tortilla")["entries"][0]["created_by_name"] == "Martina"

    def test_a_line_two_people_contributed_to_keeps_the_first_name(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        """ "Who put this on the list" happened once. The merge adds a quantity,
        not a second authorship."""
        nel, martina = _share_a_kitchen(repository, kitchens)
        plan = _assign(nel)
        nel.post(f"/plans/{plan['id']}/items", json={"items": [{"name": "cebolla", "amount": 2}]})
        plan = martina.post(f"/plans/{plan['id']}/items", json={"items": [{"name": "cebolla", "amount": 3}]}).json()

        line = _item(plan, "cebolla")

        assert (line["total_amount"], line["created_by_name"]) == (5, "Nel")

    def test_another_kitchen_is_still_a_wall(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        """Membership widened who may write; it did not widen it to everybody."""
        plan = _assign(_app(repository, kitchens))
        users = _users()
        users.add("user-stranger", "s@example.com", "Stranger")
        stranger = _app(repository, kitchens, caller="user-stranger", users=users)

        assert stranger.get("/plans", params={"plan_id": plan["id"]}).status_code == 403
        assert stranger.post(f"/plans/{plan['id']}/items", json={"items": [{"name": "x"}]}).status_code == 403

    def test_inviting_the_same_person_twice_is_a_double_tap(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        nel = _app(repository, kitchens)
        nel.post("/kitchen/members", json={"user_id": SOMEONE_ELSE})

        again = nel.post("/kitchen/members", json={"user_id": SOMEONE_ELSE})

        assert again.status_code == 201
        assert len(again.json()["pending"]) == 1

    def test_inviting_somebody_who_is_gone_says_so(self, client: TestClient) -> None:
        """Only reachable from a picker drawn before they left, so the message
        has to explain a list that was right a minute ago."""
        response = client.post("/kitchen/members", json={"user_id": "user-ghost"})

        assert response.status_code == 404
        assert "no longer" in response.json()["detail"]

    def test_inviting_yourself_is_rejected(self, client: TestClient) -> None:
        assert client.post("/kitchen/members", json={"user_id": OWNER}).status_code == 422

    def test_inviting_somebody_already_here_is_rejected(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        """Absorbing it would render her as a pending invitation sitting next to
        her own member row."""
        nel, _ = _share_a_kitchen(repository, kitchens)

        assert nel.post("/kitchen/members", json={"user_id": SOMEONE_ELSE}).status_code == 422

    def test_an_invitation_can_be_withdrawn(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        """Undoing an invitation you sent is undoing your own action, not acting
        on somebody else — which is why this one exception to the rule below is
        not really one."""
        nel = _app(repository, kitchens)
        nel.post("/kitchen/members", json={"user_id": SOMEONE_ELSE})

        after = nel.request("DELETE", f"/kitchen/members/{SOMEONE_ELSE}")

        assert after.status_code == 200
        assert after.json()["pending"] == []
        assert _app(repository, kitchens, caller=SOMEONE_ELSE).get("/kitchen").json()["invitations"] == []

    def test_nobody_can_be_removed_by_anybody_but_themselves(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        """With no owner and no admin, an eject button would have to invent one —
        and "we live together" should not have a person who can end it
        unilaterally from inside the app."""
        nel, _ = _share_a_kitchen(repository, kitchens)

        assert nel.request("DELETE", f"/kitchen/members/{SOMEONE_ELSE}").status_code == 403

    def test_leaving_puts_you_in_a_kitchen_of_your_own(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        nel, martina = _share_a_kitchen(repository, kitchens)
        shared = nel.get("/kitchen").json()["kitchen"]["id"]

        after = martina.request("DELETE", f"/kitchen/members/{SOMEONE_ELSE}").json()

        assert after["id"] != shared
        assert [m["display_name"] for m in after["members"]] == ["Martina"]
        assert [m["display_name"] for m in nel.get("/kitchen").json()["kitchen"]["members"]] == ["Nel"]

    def test_leaving_a_kitchen_you_are_alone_in_is_refused(self, client: TestClient) -> None:
        """It would create a second empty household and move nothing. Refused
        rather than absorbed, because the button should not be on screen and a
        silent success would hide that it is."""
        assert client.request("DELETE", f"/kitchen/members/{OWNER}").status_code == 422

    def test_the_week_she_leaves_behind_is_no_longer_hers_to_write(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        nel, martina = _share_a_kitchen(repository, kitchens)
        plan = _assign(nel)
        martina.request("DELETE", f"/kitchen/members/{SOMEONE_ELSE}")

        assert martina.post(f"/plans/{plan['id']}/items", json={"items": [{"name": "x"}]}).status_code == 403

    def test_the_week_she_leaves_behind_is_still_hers_to_read(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        """Moving out does not delete what you ate last August (§8.12). This is
        the one case where reading is wider than writing."""
        nel, martina = _share_a_kitchen(repository, kitchens)
        plan = _assign(nel)
        martina.request("DELETE", f"/kitchen/members/{SOMEONE_ELSE}")

        assert martina.get("/plans", params={"plan_id": plan["id"]}).json()["id"] == plan["id"]
        assert [w["id"] for w in martina.get("/plans/archive", params={"year": 2026}).json()] == [plan["id"]]

    def test_she_can_be_invited_back(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        """Rejoining reuses the row she left behind rather than stacking a second
        one — which is what keeps "was she ever here?" a single-row question."""
        nel, martina = _share_a_kitchen(repository, kitchens)
        shared = nel.get("/kitchen").json()["kitchen"]["id"]
        martina.request("DELETE", f"/kitchen/members/{SOMEONE_ELSE}")

        nel.post("/kitchen/members", json={"user_id": SOMEONE_ELSE})
        martina.patch(f"/kitchen/invitations/{shared}", json={"accept": True})

        assert martina.get("/kitchen").json()["kitchen"]["id"] == shared

    def test_an_invitation_addressed_to_somebody_else_cannot_be_accepted(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        nel = _app(repository, kitchens)
        nel.post("/kitchen/members", json={"user_id": SOMEONE_ELSE})
        theirs = nel.get("/kitchen").json()["kitchen"]["id"]

        users = _users()
        users.add("user-stranger", "s@example.com", "Stranger")
        stranger = _app(repository, kitchens, caller="user-stranger", users=users)

        assert stranger.patch(f"/kitchen/invitations/{theirs}", json={"accept": True}).status_code == 404


class TestWhoYouCanInvite:
    """The list the invite picker draws (§8.12).

    Inviting used to mean typing a display name exactly, which made "Martina"
    and "martina" and "Marina" three different outcomes. This list is what
    replaced that, so what matters is that it is *already correct* — everybody
    on it can be invited, and tapping any row works.
    """

    def _people(self, client: TestClient) -> list[str]:
        response = client.get("/kitchen/people")
        assert response.status_code == 200
        return [person["display_name"] for person in response.json()]

    def test_it_offers_the_others(self, client: TestClient) -> None:
        assert self._people(client) == ["Martina"]

    def test_it_never_offers_you(self, client: TestClient) -> None:
        """Inviting yourself is the one row that could only ever error."""
        assert "Nel" not in self._people(client)

    def test_it_drops_somebody_already_asked(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        nel = _app(repository, kitchens)
        nel.post("/kitchen/members", json={"user_id": SOMEONE_ELSE})

        assert self._people(nel) == []

    def test_it_drops_somebody_already_here(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        nel, _ = _share_a_kitchen(repository, kitchens)

        assert self._people(nel) == []

    def test_it_leaves_out_people_who_have_not_chosen_a_name(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        """NULL means "still signing up". A blank row cannot be picked, and
        rendering their id instead would be worse than leaving them out."""
        users = _users()
        users.ensure_user("user-nameless", "nameless@example.com")

        assert self._people(_app(repository, kitchens, users=users)) == ["Martina"]

    def test_it_is_in_name_order(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        """A list you scan for a name has to be scannable by name."""
        users = _users()
        users.add("user-ana", "ana@example.com", "ana")
        users.add("user-zoe", "zoe@example.com", "Zoe")

        assert self._people(_app(repository, kitchens, users=users)) == ["ana", "Martina", "Zoe"]

    def test_it_hands_out_no_email_addresses(self, client: TestClient) -> None:
        """The only place this app shows somebody else's account. A name and an
        id are what the picker needs; an address is not."""
        assert set(client.get("/kitchen/people").json()[0]) == {"id", "display_name"}

    def test_every_row_it_offers_can_actually_be_invited(self, client: TestClient) -> None:
        """The point of the list: no row on it is a dead end."""
        for person in client.get("/kitchen/people").json():
            assert client.post("/kitchen/members", json={"user_id": person["id"]}).status_code == 201


class TestTheArchive:
    """The year view (§5.3) — which weeks were planned, and which were given.

    The payoff for §4.4's real dates and §4.5's saved artifact. A rolling week
    overwritten every Monday could not answer "what did we eat in August?" at
    all, so these tests are mostly about *keeping* things: a closed week still
    appears, and a week someone shared appears alongside your own without
    pretending to be yours.
    """

    def _plan_week(self, client: TestClient, monday: date, dish: str = "Lentejas") -> dict:
        return _assign(client, day=monday, name=dish)

    def test_an_empty_year_is_an_empty_list(self, client: TestClient) -> None:
        assert client.get("/plans/archive", params={"year": 2026}).json() == []

    def test_a_planned_week_appears(self, client: TestClient) -> None:
        self._plan_week(client, SATURDAY)

        archive = client.get("/plans/archive", params={"year": 2026}).json()

        assert [w["week_start"] for w in archive] == [SATURDAY.isoformat()]

    def test_weeks_come_back_newest_first(self, client: TestClient) -> None:
        """The archive is read backwards from now, not forwards from January."""
        self._plan_week(client, date(2026, 2, 28))
        self._plan_week(client, date(2026, 9, 5))
        self._plan_week(client, date(2026, 5, 30))

        archive = client.get("/plans/archive", params={"year": 2026}).json()

        assert [w["week_start"] for w in archive] == ["2026-09-05", "2026-05-30", "2026-02-28"]

    def test_a_closed_week_is_still_in_the_archive(self, client: TestClient) -> None:
        """Archiving is the point. A week that disappeared when you finished
        shopping would make the whole feature pointless."""
        plan = self._plan_week(client, SATURDAY)
        client.post(f"/plans/{plan['id']}/status", json={"from_status": "planning"})
        client.post(f"/plans/{plan['id']}/status", json={"from_status": "calendar_closed"})

        archive = client.get("/plans/archive", params={"year": 2026}).json()

        assert [w["status"] for w in archive] == ["list_closed"]

    def test_the_counts_describe_how_full_the_week_was(self, client: TestClient) -> None:
        plan = self._plan_week(client, SATURDAY)
        plan = client.post(f"/plans/{plan['id']}/items", json={"items": [{"name": "cebolla"}, {"name": "sal"}]}).json()
        item = _item(plan, "sal")
        client.patch(f"/plans/{plan['id']}/items/{item['id']}", json={"is_checked": True})

        week = client.get("/plans/archive", params={"year": 2026}).json()[0]

        assert (week["entry_count"], week["item_count"], week["checked_count"]) == (1, 2, 1)

    def test_the_counts_do_not_multiply_each_other(self, client: TestClient) -> None:
        """A joined count would return entries x items — 3 and 4 would both come
        back as 12. The scalar subqueries exist for exactly this."""
        plan = self._plan_week(client, SATURDAY)
        _assign(client, day=SATURDAY, meal="lunch", name="Second")
        _assign(client, day=WEDNESDAY, meal="dinner", name="Third")
        client.post(f"/plans/{plan['id']}/items", json={"items": [{"name": "a"}, {"name": "b"}, {"name": "c"}, {"name": "d"}]})

        week = client.get("/plans/archive", params={"year": 2026}).json()[0]

        assert (week["entry_count"], week["item_count"]) == (3, 4)

    def test_other_years_are_excluded(self, client: TestClient) -> None:
        self._plan_week(client, date(2025, 12, 29))
        self._plan_week(client, SATURDAY)

        assert [w["week_start"] for w in client.get("/plans/archive", params={"year": 2026}).json()] == [SATURDAY.isoformat()]

    def test_a_week_straddling_new_year_belongs_to_its_mondays_year(self, client: TestClient) -> None:
        """Monday 2025-12-29 runs into January, and lands in 2025 only — the same
        rule `week_start_for` applies everywhere else, so a week is never in two
        years and never in none."""
        self._plan_week(client, date(2025, 12, 29))

        assert len(client.get("/plans/archive", params={"year": 2025}).json()) == 1
        assert client.get("/plans/archive", params={"year": 2026}).json() == []

    def test_the_kitchens_weeks_are_both_peoples_archive(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        """No `is_mine` flag any more, and nothing to put one on: a week planned
        in your kitchen is your week, whichever of you filled it in."""
        nel, martina = _share_a_kitchen(repository, kitchens)
        _assign(nel, day=SATURDAY)

        assert [w["week_start"] for w in martina.get("/plans/archive", params={"year": 2026}).json()] == [SATURDAY.isoformat()]

    def test_weeks_from_a_kitchen_she_left_stay_in_her_archive(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        """Both halves of §8.12's promise in one place: the old week keeps its
        place in the record, and the new kitchen's week arrives alongside it."""
        nel, martina = _share_a_kitchen(repository, kitchens)
        together = _assign(nel, day=SATURDAY)
        martina.request("DELETE", f"/kitchen/members/{SOMEONE_ELSE}")
        alone = _assign(martina, day=date(2026, 9, 14))

        archive = martina.get("/plans/archive", params={"year": 2026}).json()

        assert [w["id"] for w in archive] == [alone["id"], together["id"]], "newest first, across both kitchens"

    def test_a_strangers_week_is_invisible(self, repository: InMemoryMealPlanRepository, kitchens: InMemoryKitchenRepository) -> None:
        _assign(_app(repository, kitchens))
        users = _users()
        users.add("user-stranger", "s@example.com", "Stranger")

        stranger = _app(repository, kitchens, caller="user-stranger", users=users)

        assert stranger.get("/plans/archive", params={"year": 2026}).json() == []

    def test_an_unusable_year_is_rejected_rather_than_scanned(self, client: TestClient) -> None:
        assert client.get("/plans/archive", params={"year": "banana"}).status_code == 422
        assert client.get("/plans/archive", params={"year": 1200}).status_code == 422


class TestAListBeforeAnyDish:
    """The mid-week case: you notice the sugar is low and want it on the *next*
    shop, without planning a single meal to justify it.

    Before this, `AssignDish` was the only thing that created a plan row, so the
    list was unreachable until a dish existed. These pin that the list is now a
    way in of its own.
    """

    def test_adding_a_line_creates_the_week(self, client: TestClient) -> None:
        assert client.get(f"/plans?day={SATURDAY.isoformat()}").json() is None

        response = client.post("/plans/items", json={"day": SATURDAY.isoformat(), "items": [{"name": "Azúcar"}]})

        assert response.status_code == 201, response.text
        plan = response.json()
        assert plan["week_start"] == SATURDAY.isoformat()
        # The point of the whole exercise: a real week, with a list, and nothing
        # in the calendar at all.
        assert plan["entries"] == []
        assert [i["display_name"] for i in plan["items"]] == ["Azúcar"]

    def test_the_week_is_then_a_normal_week(self, client: TestClient) -> None:
        client.post("/plans/items", json={"day": SATURDAY.isoformat(), "items": [{"name": "Azúcar"}]})

        # Fetched by the ordinary week route, assignable by the ordinary slot
        # route — it is not a second kind of object.
        assert client.get(f"/plans?day={SATURDAY.isoformat()}").json()["items"][0]["display_name"] == "Azúcar"
        plan = _assign(client, day=WEDNESDAY, name="Lentejas")
        assert len(plan["entries"]) == 1
        assert len(plan["items"]) == 1

    def test_any_day_of_the_week_reaches_the_same_list(self, client: TestClient) -> None:
        client.post("/plans/items", json={"day": SATURDAY.isoformat(), "items": [{"name": "Azúcar"}]})
        response = client.post("/plans/items", json={"day": WEDNESDAY.isoformat(), "items": [{"name": "Papel de cocina"}]})

        assert response.status_code == 201
        # One plan, not two: Wednesday resolves to the same Saturday (§4.4).
        assert len(response.json()["items"]) == 2

    def test_a_hand_added_line_merges_with_a_dish_that_arrives_later(self, client: TestClient) -> None:
        client.post("/plans/items", json={"day": SATURDAY.isoformat(), "items": [{"name": "Cebolla", "amount": 1}]})
        plan = _assign(client, name="Sofrito")
        entry = _entry(plan, "Sofrito")

        client.post(
            f"/plans/{plan['id']}/items",
            json={"entry_id": entry["id"], "dish_name": "Sofrito", "items": [{"name": "Cebolla", "amount": 2}]},
        )

        # "list get mixed" — the hand-added line and the dish's line are one line.
        merged = _item(client.get(f"/plans?day={SATURDAY.isoformat()}").json(), "Cebolla")
        assert merged["total_amount"] == 3

    def test_lines_are_manual_even_though_the_week_has_dishes(self, client: TestClient) -> None:
        _assign(client, name="Lentejas")
        plan = client.post("/plans/items", json={"day": SATURDAY.isoformat(), "items": [{"name": "Azúcar"}]}).json()

        assert _item(plan, "Azúcar")["is_manual"] is True
        assert _item(plan, "Azúcar")["sources"] == []

    def test_a_closed_week_still_refuses(self, client: TestClient) -> None:
        plan = _assign(client, name="Lentejas")
        client.post(f"/plans/{plan['id']}/status", json={"from_status": "planning"})
        client.post(f"/plans/{plan['id']}/status", json={"from_status": "calendar_closed"})

        response = client.post("/plans/items", json={"day": SATURDAY.isoformat(), "items": [{"name": "Azúcar"}]})

        # 409, not 403: the week is archived, it is not somebody else's.
        assert response.status_code == 409


class TestCarryingOverWhatYouDidntGet:
    """Closing the list offers the unticked lines to next week (§4.5's cycle).

    The week still closes clean — "everything renews" — but the thing Mercadona
    was out of is not silently deleted.
    """

    NEXT_SATURDAY = date(2026, 9, 12)

    def _shopped(self, client: TestClient) -> dict:
        """A week with two lines, one of them bought, ready to close."""
        plan = _assign(client, name="Lentejas")
        entry = _entry(plan, "Lentejas")
        client.post(
            f"/plans/{plan['id']}/items",
            json={
                "entry_id": entry["id"],
                "dish_name": "Lentejas",
                "items": [{"name": "Lentejas", "amount": 500, "unit": "g"}, {"name": "Azúcar"}],
            },
        )
        plan = client.post(f"/plans/{plan['id']}/status", json={"from_status": "planning"}).json()
        bought = _item(plan, "Lentejas")
        client.patch(f"/plans/{plan['id']}/items/{bought['id']}", json={"is_checked": True})
        return client.get(f"/plans?day={SATURDAY.isoformat()}").json()

    def test_chosen_lines_land_on_next_weeks_list(self, client: TestClient) -> None:
        plan = self._shopped(client)
        sugar = _item(plan, "Azúcar")

        response = client.post(f"/plans/{plan['id']}/status", json={"from_status": "calendar_closed", "carry_over": [sugar["id"]]})

        assert response.status_code == 200, response.text
        assert response.json()["status"] == "list_closed"
        following = client.get(f"/plans?day={self.NEXT_SATURDAY.isoformat()}").json()
        assert [i["display_name"] for i in following["items"]] == ["Azúcar"]

    def test_next_week_is_created_if_it_does_not_exist(self, client: TestClient) -> None:
        plan = self._shopped(client)
        assert client.get(f"/plans?day={self.NEXT_SATURDAY.isoformat()}").json() is None

        client.post(f"/plans/{plan['id']}/status", json={"from_status": "calendar_closed", "carry_over": [_item(plan, "Azúcar")["id"]]})

        following = client.get(f"/plans?day={self.NEXT_SATURDAY.isoformat()}").json()
        assert following is not None
        assert following["entries"] == []
        assert following["status"] == "planning"

    def test_a_carried_line_arrives_by_hand_not_attributed_to_last_weeks_dish(self, client: TestClient) -> None:
        plan = self._shopped(client)
        lentejas = _item(plan, "Lentejas")
        # Untick it so it qualifies, then carry it: it came from a dish.
        client.patch(f"/plans/{plan['id']}/items/{lentejas['id']}", json={"is_checked": False})

        client.post(f"/plans/{plan['id']}/status", json={"from_status": "calendar_closed", "carry_over": [lentejas["id"]]})

        carried = _item(client.get(f"/plans?day={self.NEXT_SATURDAY.isoformat()}").json(), "Lentejas")
        # The dish that justified it belongs to the week that just closed; a
        # breakdown row pointing there would go nowhere.
        assert carried["sources"] == []
        assert carried["is_manual"] is True
        assert carried["total_amount"] == 500
        assert carried["unit"] == "g"

    def test_carrying_nothing_leaves_next_week_alone(self, client: TestClient) -> None:
        plan = self._shopped(client)

        client.post(f"/plans/{plan['id']}/status", json={"from_status": "calendar_closed"})

        # No empty week created for a carry-over nobody asked for.
        assert client.get(f"/plans?day={self.NEXT_SATURDAY.isoformat()}").json() is None

    def test_a_line_ticked_in_the_meantime_is_skipped_not_fatal(self, client: TestClient) -> None:
        plan = self._shopped(client)
        bought = _item(plan, "Lentejas")

        # The other person in the shop found it after all, between the modal
        # opening and the confirm landing.
        response = client.post(
            f"/plans/{plan['id']}/status",
            json={"from_status": "calendar_closed", "carry_over": [bought["id"], _item(plan, "Azúcar")["id"]]},
        )

        assert response.status_code == 200
        following = client.get(f"/plans?day={self.NEXT_SATURDAY.isoformat()}").json()
        assert [i["display_name"] for i in following["items"]] == ["Azúcar"]

    def test_an_id_from_another_list_is_refused(self, client: TestClient) -> None:
        plan = self._shopped(client)

        response = client.post(
            f"/plans/{plan['id']}/status",
            json={"from_status": "calendar_closed", "carry_over": ["a4e6b8c0-2d19-4000-8000-000000000000"]},
        )

        assert response.status_code == 404
        # And the week did not close on the way to failing.
        assert client.get(f"/plans?day={SATURDAY.isoformat()}").json()["status"] == "calendar_closed"

    def test_closing_the_calendar_cannot_carry_anything(self, client: TestClient) -> None:
        plan = _assign(client, name="Lentejas")
        entry = _entry(plan, "Lentejas")
        plan = client.post(
            f"/plans/{plan['id']}/items",
            json={"entry_id": entry["id"], "dish_name": "Lentejas", "items": [{"name": "Azúcar"}]},
        ).json()

        response = client.post(
            f"/plans/{plan['id']}/status",
            json={"from_status": "planning", "carry_over": [_item(plan, "Azúcar")["id"]]},
        )

        # Nothing has been shopped for yet, so every line would qualify.
        assert response.status_code == 422
        assert client.get(f"/plans?day={SATURDAY.isoformat()}").json()["status"] == "planning"

    def test_carrying_into_a_week_that_already_has_a_list_merges(self, client: TestClient) -> None:
        plan = self._shopped(client)
        client.post("/plans/items", json={"day": self.NEXT_SATURDAY.isoformat(), "items": [{"name": "Azúcar"}]})

        client.post(f"/plans/{plan['id']}/status", json={"from_status": "calendar_closed", "carry_over": [_item(plan, "Azúcar")["id"]]})

        following = client.get(f"/plans?day={self.NEXT_SATURDAY.isoformat()}").json()
        # One line, not two — the ordinary merge key, doing its ordinary job.
        assert [i["display_name"] for i in following["items"]] == ["Azúcar"]
