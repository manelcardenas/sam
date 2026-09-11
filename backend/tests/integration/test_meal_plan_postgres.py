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


@pytest.fixture
def owner(pool: DatabaseConnectionPool) -> str:
    """A throwaway user, because meal_plans.owner_id is a real foreign key."""
    user_id = f"test-{uuid.uuid4()}"
    with pool.session_factory() as session:
        session.execute(
            text("INSERT INTO users (id, email) VALUES (:id, :email)"),
            {"id": user_id, "email": f"{user_id}@example.test"},
        )
        session.commit()
    yield user_id
    with pool.session_factory() as session:
        session.execute(text("DELETE FROM meal_plans WHERE owner_id = :id"), {"id": user_id})
        session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        session.commit()


@pytest.fixture
def repository(pool: DatabaseConnectionPool) -> PostgresMealPlanRepository:
    return PostgresMealPlanRepository(session_factory=pool.session_factory)


def _line(name: str, amount: float | None = None, unit: str | None = None, entry_id: str | None = None, dish: str = "Tortilla") -> ShoppingListItem:
    return ShoppingListItem(
        display_name=name,
        normalised_name="",  # derived by the repository from display_name
        unit=unit,
        total_amount=amount,
        sources=[ListItemSource(entry_id=entry_id, dish_name=dish, amount=amount)],
    )


class TestTheEnumsRoundTrip:
    def test_a_plan_saves_and_reads_back(self, repository: PostgresMealPlanRepository, owner: str) -> None:
        """The regression. `status` is an enum column, and this is the insert
        that failed in production."""
        plan = repository.create_plan(owner, MONDAY)

        assert plan.status is PlanStatus.PLANNING
        assert repository.get_plan(plan.id).status is PlanStatus.PLANNING

    def test_both_meals_round_trip(self, repository: PostgresMealPlanRepository, owner: str) -> None:
        plan = repository.create_plan(owner, MONDAY)
        for meal in ("lunch", "dinner"):
            repository.upsert_entry(plan.id, PlanEntry(date=MONDAY, meal=meal, dish_name=f"x-{meal}", servings=2))

        assert {e.meal.value for e in repository.get_plan(plan.id).entries} == {"lunch", "dinner"}

    def test_every_status_can_be_written(self, repository: PostgresMealPlanRepository, owner: str) -> None:
        plan = repository.create_plan(owner, MONDAY)
        for status in PlanStatus:
            assert repository.set_status(plan.id, status).status is status


class TestTheMergeUpsert:
    """The COALESCE index, which is the thing a fake cannot be wrong about the
    same way — Postgres treats NULLs as distinct and Python does not."""

    def test_two_unitless_lines_merge_into_one(self, repository: PostgresMealPlanRepository, owner: str) -> None:
        plan = repository.create_plan(owner, MONDAY)
        repository.add_items(plan.id, [_line("cebolla", 1)])
        repository.add_items(plan.id, [_line("Cebolla", 2)])

        items = repository.get_plan(plan.id).items
        assert len(items) == 1
        assert items[0].total_amount == 3

    def test_the_same_name_in_two_units_stays_two_rows(self, repository: PostgresMealPlanRepository, owner: str) -> None:
        plan = repository.create_plan(owner, MONDAY)
        repository.add_items(plan.id, [_line("aceite", 200, "ml")])
        repository.add_items(plan.id, [_line("aceite", 2, "cucharada")])

        assert len(repository.get_plan(plan.id).items) == 2

    def test_an_unmeasured_line_keeps_a_null_total(self, repository: PostgresMealPlanRepository, owner: str) -> None:
        """Numeric round-trips as Decimal; None must survive as None rather than
        arriving as 0."""
        plan = repository.create_plan(owner, MONDAY)
        repository.add_items(plan.id, [_line("sal")])
        repository.add_items(plan.id, [_line("sal")])

        items = repository.get_plan(plan.id).items
        assert len(items) == 1
        assert items[0].total_amount is None

    def test_decimal_amounts_survive_the_round_trip(self, repository: PostgresMealPlanRepository, owner: str) -> None:
        plan = repository.create_plan(owner, MONDAY)
        repository.add_items(plan.id, [_line("harina", 66.67, "g")])

        assert repository.get_plan(plan.id).items[0].total_amount == 66.67


class TestHistorySurvives:
    def test_removing_an_entry_leaves_the_list_line_and_its_dish_name(self, repository: PostgresMealPlanRepository, owner: str) -> None:
        """ON DELETE SET NULL on list_item_sources.entry_id, plus the dish_name
        snapshot. With CASCADE the breakdown would vanish with the dish."""
        plan = repository.create_plan(owner, MONDAY)
        entry = repository.upsert_entry(plan.id, PlanEntry(date=MONDAY, meal="dinner", dish_name="Tortilla", servings=4))
        repository.add_items(plan.id, [_line("cebolla", 1, entry_id=entry.id, dish="Tortilla")])

        repository.delete_entry(entry.id)

        items = repository.get_plan(plan.id).items
        assert len(items) == 1
        assert items[0].sources[0].dish_name == "Tortilla"
        assert items[0].sources[0].entry_id is None

    def test_unpicking_a_dish_leaves_what_other_dishes_still_need(self, repository: PostgresMealPlanRepository, owner: str) -> None:
        plan = repository.create_plan(owner, MONDAY)
        first = repository.upsert_entry(plan.id, PlanEntry(date=MONDAY, meal="dinner", dish_name="Tortilla", servings=4))
        second = repository.upsert_entry(plan.id, PlanEntry(date=WEDNESDAY, meal="dinner", dish_name="Lentejas", servings=4))
        repository.add_items(plan.id, [_line("cebolla", 1, entry_id=first.id, dish="Tortilla")])
        repository.add_items(plan.id, [_line("cebolla", 2, entry_id=second.id, dish="Lentejas")])

        removed = repository.drop_sources_for_entry(first.id)

        items = repository.get_plan(plan.id).items
        assert removed == 0
        assert items[0].total_amount == 2
        assert [s.dish_name for s in items[0].sources] == ["Lentejas"]

    def test_the_slot_is_unique_so_reassigning_replaces(self, repository: PostgresMealPlanRepository, owner: str) -> None:
        """uq_plan_entries_slot. A fake enforces this by looking; Postgres
        enforces it with an index, and only one of those can be wrong."""
        plan = repository.create_plan(owner, MONDAY)
        repository.upsert_entry(plan.id, PlanEntry(date=MONDAY, meal="dinner", dish_name="Tortilla", servings=4))
        repository.upsert_entry(plan.id, PlanEntry(date=MONDAY, meal="dinner", dish_name="Lentejas", servings=2))

        entries = repository.get_plan(plan.id).entries
        assert [e.dish_name for e in entries] == ["Lentejas"]


class TestOrdering:
    def test_lunch_sorts_before_dinner(self, repository: PostgresMealPlanRepository, owner: str) -> None:
        """ "dinner" < "lunch" alphabetically, so this is the ordering that
        renders every day backwards if the domain comparator is bypassed."""
        plan = repository.create_plan(owner, MONDAY)
        repository.upsert_entry(plan.id, PlanEntry(date=MONDAY, meal="dinner", dish_name="Second", servings=2))
        repository.upsert_entry(plan.id, PlanEntry(date=MONDAY, meal="lunch", dish_name="First", servings=2))

        assert [e.dish_name for e in repository.get_plan(plan.id).entries] == ["First", "Second"]


class TestSharing:
    """The join table, against real SQL (§4.3).

    The in-memory fake cannot be wrong the same way here: `ON CONFLICT DO
    NOTHING` and `ON DELETE CASCADE` are behaviours of the database, not of the
    repository, and both are load-bearing.
    """

    @pytest.fixture
    def guest(self, pool: DatabaseConnectionPool) -> str:
        user_id = f"test-guest-{uuid.uuid4()}"
        with pool.session_factory() as session:
            session.execute(
                text("INSERT INTO users (id, email, display_name) VALUES (:id, :email, :name)"),
                {"id": user_id, "email": f"{user_id}@example.test", "name": f"Guest {user_id[-8:]}"},
            )
            session.commit()
        yield user_id
        with pool.session_factory() as session:
            session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
            session.commit()

    def test_a_share_round_trips_with_the_guests_name(self, repository: PostgresMealPlanRepository, owner: str, guest: str) -> None:
        plan = repository.create_plan(owner, MONDAY)

        repository.share_plan(plan.id, guest)

        guests = repository.get_plan(plan.id).shared_with
        assert [g.user_id for g in guests] == [guest]
        assert guests[0].display_name is not None, "the name comes off the joined users row"

    def test_sharing_twice_does_not_raise_on_the_primary_key(self, repository: PostgresMealPlanRepository, owner: str, guest: str) -> None:
        """ON CONFLICT DO NOTHING. A SELECT-then-INSERT would race into a
        primary-key violation on a table whose entire content is that key."""
        plan = repository.create_plan(owner, MONDAY)

        repository.share_plan(plan.id, guest)
        repository.share_plan(plan.id, guest)

        assert len(repository.get_plan(plan.id).shared_with) == 1

    def test_unsharing_is_idempotent_too(self, repository: PostgresMealPlanRepository, owner: str, guest: str) -> None:
        plan = repository.create_plan(owner, MONDAY)
        repository.share_plan(plan.id, guest)

        repository.unshare_plan(plan.id, guest)
        repository.unshare_plan(plan.id, guest)

        assert repository.get_plan(plan.id).shared_with == []

    def test_a_guest_finds_the_plan_by_week(self, repository: PostgresMealPlanRepository, owner: str, guest: str) -> None:
        plan = repository.create_plan(owner, MONDAY)
        repository.share_plan(plan.id, guest)

        assert [p.id for p in repository.list_shared_with(guest, MONDAY)] == [plan.id]
        assert repository.list_shared_with(guest, date(2026, 9, 14)) == []

    def test_deleting_the_guest_removes_the_share(self, repository: PostgresMealPlanRepository, owner: str, guest: str, pool: DatabaseConnectionPool) -> None:
        """ON DELETE CASCADE on users. Without it a deleted account leaves a row
        granting access to a user id that resolves to nobody — and the plan then
        renders a nameless guest it cannot remove."""
        plan = repository.create_plan(owner, MONDAY)
        repository.share_plan(plan.id, guest)

        with pool.session_factory() as session:
            session.execute(text("DELETE FROM users WHERE id = :id"), {"id": guest})
            session.commit()

        assert repository.get_plan(plan.id).shared_with == []

    def test_deleting_the_plan_removes_the_share(self, repository: PostgresMealPlanRepository, owner: str, guest: str, pool: DatabaseConnectionPool) -> None:
        plan = repository.create_plan(owner, MONDAY)
        repository.share_plan(plan.id, guest)

        with pool.session_factory() as session:
            session.execute(text("DELETE FROM meal_plans WHERE id = :id"), {"id": plan.id})
            session.commit()

        assert repository.list_shared_with(guest, MONDAY) == []


class TestTheArchive:
    """The year view's SQL (§5.3), which the fake cannot get wrong the same way.

    The counts are correlated scalar subqueries. Written as joins with GROUP BY
    they would multiply — five entries and twenty list lines give a hundred rows
    and two wrong numbers — and that is invisible in a fake, where they are just
    two calls to `len()`.
    """

    @pytest.fixture
    def guest(self, pool: DatabaseConnectionPool) -> str:
        user_id = f"test-guest-{uuid.uuid4()}"
        with pool.session_factory() as session:
            session.execute(
                text("INSERT INTO users (id, email, display_name) VALUES (:id, :email, :name)"),
                {"id": user_id, "email": f"{user_id}@example.test", "name": f"Guest {user_id[-8:]}"},
            )
            session.commit()
        yield user_id
        with pool.session_factory() as session:
            session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
            session.commit()

    def test_counts_do_not_multiply_each_other(self, repository: PostgresMealPlanRepository, owner: str) -> None:
        plan = repository.create_plan(owner, MONDAY)
        for meal, day in (("lunch", MONDAY), ("dinner", MONDAY), ("dinner", WEDNESDAY)):
            repository.upsert_entry(plan.id, PlanEntry(date=day, meal=meal, dish_name=f"{day}-{meal}", servings=2))
        repository.add_items(plan.id, [_line(name) for name in ("a", "b", "c", "d")])

        week = repository.list_year(owner, 2026)[0]

        assert (week.entry_count, week.item_count) == (3, 4)

    def test_checked_lines_are_counted_separately(self, repository: PostgresMealPlanRepository, owner: str) -> None:
        plan = repository.create_plan(owner, MONDAY)
        items = repository.add_items(plan.id, [_line("a"), _line("b")])
        repository.set_item_checked(items[0].id, True)

        week = repository.list_year(owner, 2026)[0]

        assert (week.item_count, week.checked_count) == (2, 1)

    def test_the_year_filter_uses_the_weeks_monday(self, repository: PostgresMealPlanRepository, owner: str) -> None:
        """`extract(year from week_start)`. A week running into January belongs
        to the year its Monday is in — never both, never neither."""
        repository.create_plan(owner, date(2025, 12, 29))

        assert len(repository.list_year(owner, 2025)) == 1
        assert repository.list_year(owner, 2026) == []

    def test_owned_and_shared_weeks_come_back_together(self, repository: PostgresMealPlanRepository, owner: str, guest: str) -> None:
        """The OR against the share table. Two separate queries could return a
        plan twice if it were ever both."""
        theirs = repository.create_plan(owner, MONDAY)
        repository.share_plan(theirs.id, guest)
        mine = repository.create_plan(guest, date(2026, 9, 14))

        archive = repository.list_year(guest, 2026)

        assert [(w.id, w.is_mine) for w in archive] == [(mine.id, True), (theirs.id, False)]

    def test_a_shared_week_carries_the_owners_name(self, repository: PostgresMealPlanRepository, owner: str, guest: str) -> None:
        plan = repository.create_plan(owner, MONDAY)
        repository.share_plan(plan.id, guest)

        assert repository.list_year(guest, 2026)[0].owner_id == owner

    def test_a_strangers_week_is_invisible(self, repository: PostgresMealPlanRepository, owner: str, guest: str) -> None:
        repository.create_plan(owner, MONDAY)

        assert repository.list_year(guest, 2026) == []
