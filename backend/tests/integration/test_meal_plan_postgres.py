"""The meal planner against a *real* Postgres. Opt-in, and skipped by default.

**Why this file exists.** Every other suite runs against `InMemoryMealPlanRepository`,
so `PostgresMealPlanRepository` shipped without ever executing. It failed on the
first real request with

    invalid input value for enum plan_status_enum: "PLANNING"

— SQLAlchemy persists an enum's member *name* unless told otherwise, and the
migration created the type with lowercase values. `test_enum_columns_match_migrations`
now guards that specific mismatch without a database. This file guards the rest:
the `COALESCE` upsert, the ON DELETE behaviour, and the Numeric round-trip, none
of which a fake can be wrong about in the same way.

**It does not run unless you ask it to**, and it never runs migrations:

    SAM_TEST_POSTGRES=1 uv run pytest tests/integration/test_meal_plan_postgres.py

It writes to whatever database `POSTGRES_*` points at, so point it at local dev —
never at production. Every test cleans up the plan it made; plans cascade to
entries, list items and sources, so one delete is enough.
"""

import os
import uuid
from datetime import date

import pytest
from dotenv import load_dotenv
from sqlalchemy import text

from src.domain.entities import ListItemSource, PlanEntry, PlanStatus, ShoppingListItem
from src.infra.adapters.repos.postgres_kitchen_repo import PostgresKitchenRepository
from src.infra.adapters.repos.postgres_meal_plan_repo import PostgresMealPlanRepository
from src.infra.db import DatabaseConnectionPool, build_dsn

pytestmark = pytest.mark.skipif(
    os.getenv("SAM_TEST_POSTGRES") != "1",
    reason="Set SAM_TEST_POSTGRES=1 to run against a real database",
)

MONDAY = date(2026, 9, 7)
WEDNESDAY = date(2026, 9, 9)


@pytest.fixture(scope="module")
def pool() -> DatabaseConnectionPool:
    # `build_dsn()` reads os.environ, and only `src.main` calls load_dotenv().
    # Without this the POSTGRES_* vars in .env are invisible here and every test
    # errors on a missing key rather than skipping or connecting.
    load_dotenv()
    db = DatabaseConnectionPool(dsn=build_dsn())
    db.open()
    yield db
    db.close()


def _make_user(pool: DatabaseConnectionPool, label: str) -> str:
    user_id = f"test-{label}-{uuid.uuid4()}"
    with pool.session_factory() as session:
        session.execute(
            text("INSERT INTO users (id, email, display_name) VALUES (:id, :email, :name)"),
            {"id": user_id, "email": f"{user_id}@example.test", "name": f"{label.title()} {user_id[-8:]}"},
        )
        session.commit()
    return user_id


def _drop_user(pool: DatabaseConnectionPool, user_id: str) -> None:
    """Take the user's kitchens with them, and everything those kitchens held.

    Deleting the user alone would leave the kitchen behind — nothing cascades
    that way, deliberately, because a kitchen outlives the person who made it
    when somebody else is still in it.
    """
    with pool.session_factory() as session:
        session.execute(
            text("DELETE FROM meal_plans WHERE kitchen_id IN (SELECT kitchen_id FROM kitchen_members WHERE user_id = :id)"),
            {"id": user_id},
        )
        session.execute(
            text("DELETE FROM kitchens WHERE id IN (SELECT kitchen_id FROM kitchen_members WHERE user_id = :id)"),
            {"id": user_id},
        )
        session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        session.commit()


@pytest.fixture
def kitchens(pool: DatabaseConnectionPool) -> PostgresKitchenRepository:
    return PostgresKitchenRepository(session_factory=pool.session_factory)


@pytest.fixture
def cook(pool: DatabaseConnectionPool) -> str:
    """A throwaway user, because every foreign key here is real."""
    user_id = _make_user(pool, "cook")
    yield user_id
    _drop_user(pool, user_id)


@pytest.fixture
def housemate(pool: DatabaseConnectionPool) -> str:
    user_id = _make_user(pool, "mate")
    yield user_id
    _drop_user(pool, user_id)


@pytest.fixture
def kitchen(kitchens: PostgresKitchenRepository, cook: str) -> str:
    """`cook`'s own kitchen. Everything below plans inside it."""
    return kitchens.create_kitchen(cook).id


@pytest.fixture
def repository(pool: DatabaseConnectionPool) -> PostgresMealPlanRepository:
    return PostgresMealPlanRepository(session_factory=pool.session_factory)


def _line(
    name: str,
    amount: float | None = None,
    unit: str | None = None,
    entry_id: str | None = None,
    dish: str = "Tortilla",
    created_by: str | None = None,
) -> ShoppingListItem:
    return ShoppingListItem(
        display_name=name,
        normalised_name="",  # derived by the repository from display_name
        unit=unit,
        total_amount=amount,
        created_by=created_by,
        sources=[ListItemSource(entry_id=entry_id, dish_name=dish, amount=amount)],
    )


class TestTheEnumsRoundTrip:
    def test_a_plan_saves_and_reads_back(self, repository: PostgresMealPlanRepository, kitchen: str) -> None:
        """The regression. `status` is an enum column, and this is the insert
        that failed in production."""
        plan = repository.create_plan(kitchen, MONDAY, None)

        assert plan.status is PlanStatus.PLANNING
        assert repository.get_plan(plan.id).status is PlanStatus.PLANNING

    def test_both_meals_round_trip(self, repository: PostgresMealPlanRepository, kitchen: str) -> None:
        plan = repository.create_plan(kitchen, MONDAY, None)
        for meal in ("lunch", "dinner"):
            repository.upsert_entry(plan.id, PlanEntry(date=MONDAY, meal=meal, dish_name=f"x-{meal}", servings=2))

        assert {e.meal.value for e in repository.get_plan(plan.id).entries} == {"lunch", "dinner"}

    def test_every_status_can_be_written(self, repository: PostgresMealPlanRepository, kitchen: str) -> None:
        plan = repository.create_plan(kitchen, MONDAY, None)
        for status in PlanStatus:
            assert repository.set_status(plan.id, status).status is status


class TestTheMergeUpsert:
    """The COALESCE index, which is the thing a fake cannot be wrong about the
    same way — Postgres treats NULLs as distinct and Python does not."""

    def test_two_unitless_lines_merge_into_one(self, repository: PostgresMealPlanRepository, kitchen: str) -> None:
        plan = repository.create_plan(kitchen, MONDAY, None)
        repository.add_items(plan.id, [_line("cebolla", 1)])
        repository.add_items(plan.id, [_line("Cebolla", 2)])

        items = repository.get_plan(plan.id).items
        assert len(items) == 1
        assert items[0].total_amount == 3

    def test_the_same_name_in_two_units_stays_two_rows(self, repository: PostgresMealPlanRepository, kitchen: str) -> None:
        plan = repository.create_plan(kitchen, MONDAY, None)
        repository.add_items(plan.id, [_line("aceite", 200, "ml")])
        repository.add_items(plan.id, [_line("aceite", 2, "cucharada")])

        assert len(repository.get_plan(plan.id).items) == 2

    def test_an_unmeasured_line_keeps_a_null_total(self, repository: PostgresMealPlanRepository, kitchen: str) -> None:
        """Numeric round-trips as Decimal; None must survive as None rather than
        arriving as 0."""
        plan = repository.create_plan(kitchen, MONDAY, None)
        repository.add_items(plan.id, [_line("sal")])
        repository.add_items(plan.id, [_line("sal")])

        items = repository.get_plan(plan.id).items
        assert len(items) == 1
        assert items[0].total_amount is None

    def test_decimal_amounts_survive_the_round_trip(self, repository: PostgresMealPlanRepository, kitchen: str) -> None:
        plan = repository.create_plan(kitchen, MONDAY, None)
        repository.add_items(plan.id, [_line("harina", 66.67, "g")])

        assert repository.get_plan(plan.id).items[0].total_amount == 66.67


class TestHistorySurvives:
    def test_removing_an_entry_leaves_the_list_line_and_its_dish_name(self, repository: PostgresMealPlanRepository, kitchen: str) -> None:
        """ON DELETE SET NULL on list_item_sources.entry_id, plus the dish_name
        snapshot. With CASCADE the breakdown would vanish with the dish."""
        plan = repository.create_plan(kitchen, MONDAY, None)
        entry = repository.upsert_entry(plan.id, PlanEntry(date=MONDAY, meal="dinner", dish_name="Tortilla", servings=4))
        repository.add_items(plan.id, [_line("cebolla", 1, entry_id=entry.id, dish="Tortilla")])

        repository.delete_entry(entry.id)

        items = repository.get_plan(plan.id).items
        assert len(items) == 1
        assert items[0].sources[0].dish_name == "Tortilla"
        assert items[0].sources[0].entry_id is None

    def test_unpicking_a_dish_leaves_what_other_dishes_still_need(self, repository: PostgresMealPlanRepository, kitchen: str) -> None:
        plan = repository.create_plan(kitchen, MONDAY, None)
        first = repository.upsert_entry(plan.id, PlanEntry(date=MONDAY, meal="dinner", dish_name="Tortilla", servings=4))
        second = repository.upsert_entry(plan.id, PlanEntry(date=WEDNESDAY, meal="dinner", dish_name="Lentejas", servings=4))
        repository.add_items(plan.id, [_line("cebolla", 1, entry_id=first.id, dish="Tortilla")])
        repository.add_items(plan.id, [_line("cebolla", 2, entry_id=second.id, dish="Lentejas")])

        removed = repository.drop_sources_for_entry(first.id)

        items = repository.get_plan(plan.id).items
        assert removed == 0
        assert items[0].total_amount == 2
        assert [s.dish_name for s in items[0].sources] == ["Lentejas"]

    def test_the_slot_is_unique_so_reassigning_replaces(self, repository: PostgresMealPlanRepository, kitchen: str) -> None:
        """uq_plan_entries_slot. A fake enforces this by looking; Postgres
        enforces it with an index, and only one of those can be wrong."""
        plan = repository.create_plan(kitchen, MONDAY, None)
        repository.upsert_entry(plan.id, PlanEntry(date=MONDAY, meal="dinner", dish_name="Tortilla", servings=4))
        repository.upsert_entry(plan.id, PlanEntry(date=MONDAY, meal="dinner", dish_name="Lentejas", servings=2))

        entries = repository.get_plan(plan.id).entries
        assert [e.dish_name for e in entries] == ["Lentejas"]


class TestOrdering:
    def test_lunch_sorts_before_dinner(self, repository: PostgresMealPlanRepository, kitchen: str) -> None:
        """ "dinner" < "lunch" alphabetically, so this is the ordering that
        renders every day backwards if the domain comparator is bypassed."""
        plan = repository.create_plan(kitchen, MONDAY, None)
        repository.upsert_entry(plan.id, PlanEntry(date=MONDAY, meal="dinner", dish_name="Second", servings=2))
        repository.upsert_entry(plan.id, PlanEntry(date=MONDAY, meal="lunch", dish_name="First", servings=2))

        assert [e.dish_name for e in repository.get_plan(plan.id).entries] == ["First", "Second"]


class TestTheKitchensConstraints:
    """The two partial/unique indexes, against real SQL (§8.12).

    These are the half of the kitchen the fake genuinely cannot be wrong about
    in the same way: `uq_kitchen_members_active_user` is a *partial* unique index,
    and whether the `WHERE` clause is right decides between "one household per
    person" and "cannot hold an invitation while living somewhere".
    """

    def test_a_new_kitchen_has_its_founder_in_it(self, kitchens: PostgresKitchenRepository, cook: str) -> None:
        kitchen = kitchens.create_kitchen(cook)

        assert [m.user_id for m in kitchen.members] == [cook]
        assert kitchen.members[0].display_name is not None, "the name comes off the joined users row"
        assert kitchens.active_kitchen_for(cook).id == kitchen.id

    def test_an_invitation_does_not_count_as_a_second_kitchen(self, kitchens: PostgresKitchenRepository, cook: str, housemate: str) -> None:
        """The partial index's whole purpose. Index the bare column and holding an
        invitation while still living in your own kitchen becomes impossible."""
        theirs = kitchens.create_kitchen(cook)
        hers = kitchens.create_kitchen(housemate)

        kitchens.invite(theirs.id, housemate, cook)

        assert kitchens.active_kitchen_for(housemate).id == hers.id
        assert [i.kitchen_id for i in kitchens.invitations_for(housemate)] == [theirs.id]

    def test_accepting_moves_her_in_one_step(self, kitchens: PostgresKitchenRepository, cook: str, housemate: str) -> None:
        """Leaving and joining in two transactions would leave a window in which
        the unique index rejects the second half."""
        theirs = kitchens.create_kitchen(cook)
        kitchens.create_kitchen(housemate)
        kitchens.invite(theirs.id, housemate, cook)

        kitchens.accept_invitation(theirs.id, housemate)

        assert kitchens.active_kitchen_for(housemate).id == theirs.id
        assert {m.user_id for m in kitchens.get_kitchen(theirs.id).members} == {cook, housemate}

    def test_rejoining_reuses_the_row_she_left_behind(self, kitchens: PostgresKitchenRepository, cook: str, housemate: str) -> None:
        """`uq_kitchen_members_pair` forbids a second row for the same pair, so a
        naive re-invite would raise on the unique index rather than revive her."""
        theirs = kitchens.create_kitchen(cook)
        kitchens.create_kitchen(housemate)
        kitchens.invite(theirs.id, housemate, cook)
        kitchens.accept_invitation(theirs.id, housemate)
        kitchens.leave(theirs.id, housemate)
        kitchens.create_kitchen(housemate)

        kitchens.invite(theirs.id, housemate, cook)
        kitchens.accept_invitation(theirs.id, housemate)

        assert kitchens.active_kitchen_for(housemate).id == theirs.id

    def test_leaving_keeps_the_kitchen_in_her_history(self, kitchens: PostgresKitchenRepository, cook: str, housemate: str) -> None:
        """The row stays with a date on it. Deleting it would take the weeks she
        planned there out of her own archive."""
        theirs = kitchens.create_kitchen(cook)
        kitchens.create_kitchen(housemate)
        kitchens.invite(theirs.id, housemate, cook)
        kitchens.accept_invitation(theirs.id, housemate)

        kitchens.leave(theirs.id, housemate)

        assert theirs.id in kitchens.kitchen_ids_for(housemate)
        assert kitchens.active_kitchen_for(housemate) is None, "she is between kitchens until one is made for her"

    def test_an_invitation_she_never_answered_grants_nothing(self, kitchens: PostgresKitchenRepository, cook: str, housemate: str) -> None:
        theirs = kitchens.create_kitchen(cook)
        kitchens.create_kitchen(housemate)

        kitchens.invite(theirs.id, housemate, cook)

        assert theirs.id not in kitchens.kitchen_ids_for(housemate)

    def test_deleting_the_account_removes_the_membership(self, kitchens: PostgresKitchenRepository, cook: str, housemate: str, pool: DatabaseConnectionPool) -> None:
        """ON DELETE CASCADE on users. Without it a deleted account leaves a row
        in somebody's kitchen that resolves to nobody and cannot be removed."""
        theirs = kitchens.create_kitchen(cook)
        kitchens.create_kitchen(housemate)
        kitchens.invite(theirs.id, housemate, cook)
        kitchens.accept_invitation(theirs.id, housemate)

        with pool.session_factory() as session:
            session.execute(text("DELETE FROM users WHERE id = :id"), {"id": housemate})
            session.commit()

        assert [m.user_id for m in kitchens.get_kitchen(theirs.id).members] == [cook]

    def test_one_plan_per_kitchen_per_week(self, repository: PostgresMealPlanRepository, kitchen: str) -> None:
        """`uq_meal_plans_kitchen_week`, which replaced the key on the owner. Two
        people in one household planning the same week used to be two plans."""
        repository.create_plan(kitchen, MONDAY, None)

        with pytest.raises(Exception, match="uq_meal_plans_kitchen_week"):
            repository.create_plan(kitchen, MONDAY, None)


class TestAttribution:
    """`created_by` on the rows two people both write, resolved through a join."""

    def test_a_dish_carries_the_name_of_whoever_assigned_it(self, repository: PostgresMealPlanRepository, kitchen: str, cook: str) -> None:
        plan = repository.create_plan(kitchen, MONDAY, cook)
        repository.upsert_entry(plan.id, PlanEntry(date=MONDAY, meal="dinner", dish_name="Tortilla", servings=4, created_by=cook))

        entry = repository.get_plan(plan.id).entries[0]

        assert entry.created_by == cook
        assert entry.created_by_name is not None, "the name comes off the joined users row"

    def test_a_list_line_carries_the_name_of_whoever_added_it(self, repository: PostgresMealPlanRepository, kitchen: str, cook: str) -> None:
        plan = repository.create_plan(kitchen, MONDAY, cook)
        repository.add_items(plan.id, [_line("cebolla", 1, created_by=cook)])

        assert repository.get_plan(plan.id).items[0].created_by_name is not None

    def test_a_merged_line_keeps_the_first_name(self, repository: PostgresMealPlanRepository, kitchen: str, cook: str, housemate: str) -> None:
        """The question is who put it on the list, and that happened once."""
        plan = repository.create_plan(kitchen, MONDAY, cook)
        repository.add_items(plan.id, [_line("cebolla", 1, created_by=cook)])
        repository.add_items(plan.id, [_line("cebolla", 2, created_by=housemate)])

        item = repository.get_plan(plan.id).items[0]

        assert (item.total_amount, item.created_by) == (3, cook)

    def test_a_departed_account_empties_the_name_without_erasing_the_week(
        self, repository: PostgresMealPlanRepository, kitchen: str, housemate: str, pool: DatabaseConnectionPool
    ) -> None:
        """ON DELETE SET NULL, for the same reason `recipe_id` uses it: deleting
        an account in November must not empty out what you ate in August."""
        plan = repository.create_plan(kitchen, MONDAY, None)
        repository.upsert_entry(plan.id, PlanEntry(date=MONDAY, meal="dinner", dish_name="Tortilla", servings=4, created_by=housemate))
        repository.add_items(plan.id, [_line("cebolla", 1, created_by=housemate)])

        with pool.session_factory() as session:
            session.execute(text("DELETE FROM users WHERE id = :id"), {"id": housemate})
            session.commit()

        after = repository.get_plan(plan.id)
        assert [e.dish_name for e in after.entries] == ["Tortilla"]
        assert after.entries[0].created_by is None
        assert after.items[0].created_by is None


class TestTheArchive:
    """The year view's SQL (§5.3), which the fake cannot get wrong the same way.

    The counts are correlated scalar subqueries. Written as joins with GROUP BY
    they would multiply — five entries and twenty list lines give a hundred rows
    and two wrong numbers — and that is invisible in a fake, where they are just
    two calls to `len()`.
    """

    def test_counts_do_not_multiply_each_other(self, repository: PostgresMealPlanRepository, kitchen: str) -> None:
        plan = repository.create_plan(kitchen, MONDAY, None)
        for meal, day in (("lunch", MONDAY), ("dinner", MONDAY), ("dinner", WEDNESDAY)):
            repository.upsert_entry(plan.id, PlanEntry(date=day, meal=meal, dish_name=f"{day}-{meal}", servings=2))
        repository.add_items(plan.id, [_line(name) for name in ("a", "b", "c", "d")])

        week = repository.list_year([kitchen], 2026)[0]

        assert (week.entry_count, week.item_count) == (3, 4)

    def test_checked_lines_are_counted_separately(self, repository: PostgresMealPlanRepository, kitchen: str) -> None:
        plan = repository.create_plan(kitchen, MONDAY, None)
        items = repository.add_items(plan.id, [_line("a"), _line("b")])
        repository.set_item_checked(items[0].id, True)

        week = repository.list_year([kitchen], 2026)[0]

        assert (week.item_count, week.checked_count) == (2, 1)

    def test_the_year_filter_uses_the_weeks_monday(self, repository: PostgresMealPlanRepository, kitchen: str) -> None:
        """`extract(year from week_start)`. A week running into January belongs
        to the year its Monday is in — never both, never neither."""
        repository.create_plan(kitchen, date(2025, 12, 29), None)

        assert len(repository.list_year([kitchen], 2025)) == 1
        assert repository.list_year([kitchen], 2026) == []

    def test_every_kitchen_she_has_been_in_comes_back_newest_first(
        self, repository: PostgresMealPlanRepository, kitchens: PostgresKitchenRepository, cook: str, housemate: str
    ) -> None:
        """Moving house does not take the old weeks with you. The `IN` over every
        kitchen she has ever accepted is what §8.12 promised."""
        together = kitchens.create_kitchen(cook)
        hers = kitchens.create_kitchen(housemate)
        kitchens.invite(together.id, housemate, cook)
        kitchens.accept_invitation(together.id, housemate)

        old = repository.create_plan(hers.id, MONDAY, housemate)
        new = repository.create_plan(together.id, date(2026, 9, 14), housemate)

        archive = repository.list_year(kitchens.kitchen_ids_for(housemate), 2026)

        assert [w.id for w in archive] == [new.id, old.id]

    def test_another_kitchens_week_is_invisible(self, repository: PostgresMealPlanRepository, kitchens: PostgresKitchenRepository, kitchen: str, housemate: str) -> None:
        repository.create_plan(kitchen, MONDAY, None)

        assert repository.list_year(kitchens.kitchen_ids_for(housemate), 2026) == []

    def test_somebody_with_no_kitchen_has_no_archive(self, repository: PostgresMealPlanRepository, kitchen: str) -> None:
        """Short-circuited before the database: `IN ()` is a syntax error in some
        dialects and a full scan in others."""
        repository.create_plan(kitchen, MONDAY, None)

        assert repository.list_year([], 2026) == []


class TestFilingALineAfterTheFact:
    """`set_item_grocery_key` against the real index. The fold is the part a
    fake can get right while Postgres refuses it: two rows briefly sharing one
    merge key is exactly what `uq_shopping_list_items_merge_key` forbids."""

    def test_a_line_with_no_twin_just_gains_its_key(self, repository: PostgresMealPlanRepository, kitchen: str) -> None:
        plan = repository.create_plan(kitchen, MONDAY, None)
        [line] = repository.add_items(plan.id, [_line("papel de horno")])

        filed = repository.set_item_grocery_key(line.id, "papel de horno")

        assert filed is not None
        assert filed.id == line.id
        assert repository.get_plan(plan.id).items[0].grocery_key == "papel de horno"

    def test_a_typo_folds_into_the_line_it_meant(self, repository: PostgresMealPlanRepository, kitchen: str) -> None:
        plan = repository.create_plan(kitchen, MONDAY, None)
        [eggs] = repository.add_items(plan.id, [_line("Huevos", 6, dish="Tortilla").model_copy(update={"grocery_key": "huevos"})])
        repository.set_item_checked(eggs.id, True)
        [typo] = repository.add_items(plan.id, [_line("huveos", 4, dish="Flan")])

        survivor = repository.set_item_grocery_key(typo.id, "huevos")

        items = repository.get_plan(plan.id).items
        assert len(items) == 1
        assert survivor is not None
        assert survivor.id == eggs.id
        assert items[0].total_amount == 10
        assert sorted(s.dish_name for s in items[0].sources) == ["Flan", "Tortilla"]
        # A fresh line folded into a ticked one is still something to buy.
        assert items[0].is_checked is False

    def test_a_quantity_read_out_of_the_name_is_kept(self, repository: PostgresMealPlanRepository, kitchen: str) -> None:
        plan = repository.create_plan(kitchen, MONDAY, None)
        [line] = repository.add_items(plan.id, [_line("200g harina")])

        repository.set_item_grocery_key(line.id, "harina", 200, "g")

        [item] = repository.get_plan(plan.id).items
        assert (item.grocery_key, item.total_amount, item.unit) == ("harina", 200, "g")

    def test_a_missing_line_is_none(self, repository: PostgresMealPlanRepository) -> None:
        assert repository.set_item_grocery_key(str(uuid.uuid4()), "huevos") is None
