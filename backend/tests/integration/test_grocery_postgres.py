"""The grocery vocabulary against a *real* Postgres. Opt-in, like the planner's.

One thing here a fake cannot vouch for: the seed's `ON CONFLICT` keeping a
confirmed row's aisle. The seed runs on every deploy, so if the `CASE` in the
update set is wrong, a person's correction survives exactly until the next push.
"""

import os
import uuid

import pytest
from dotenv import load_dotenv
from sqlalchemy import text

from src.domain.entities import Aisle, GroceryItem, GrocerySource
from src.infra.adapters.repos.postgres_grocery_repo import PostgresGroceryRepository
from src.infra.db import DatabaseConnectionPool, build_dsn

pytestmark = pytest.mark.skipif(
    os.getenv("SAM_TEST_POSTGRES") != "1",
    reason="Set SAM_TEST_POSTGRES=1 to run against a real database",
)


@pytest.fixture(scope="module")
def pool() -> DatabaseConnectionPool:
    load_dotenv()
    db = DatabaseConnectionPool(dsn=build_dsn())
    db.open()
    yield db
    db.close()


@pytest.fixture
def groceries(pool: DatabaseConnectionPool) -> PostgresGroceryRepository:
    return PostgresGroceryRepository(session_factory=pool.session_factory)


@pytest.fixture
def key(pool: DatabaseConnectionPool) -> str:
    """A throwaway row key — the vocabulary is shared, so tests must not touch real rows."""
    value = f"test grocery {uuid.uuid4()}"
    yield value
    with pool.session_factory() as session:
        session.execute(text("DELETE FROM grocery_items WHERE key = :key"), {"key": value})
        session.commit()


def _row(key: str, aisle: Aisle, **overrides: object) -> GroceryItem:
    return GroceryItem(**{"key": key, "name_es": key, "name_ca": key, "name_en": key, "aisle": aisle, "source": GrocerySource.SEED, **overrides})  # type: ignore[arg-type]


class TestAdminWrites:
    def test_update_rewrites_every_editable_field(self, groceries: PostgresGroceryRepository, key: str) -> None:
        groceries.upsert_many([_row(key, Aisle.OTHER)])
        edited = groceries.get(key).model_copy(  # type: ignore[union-attr]
            update={"name_es": "Nuevo", "aisle": Aisle.CANNED, "is_pantry": True, "default_unit": "g", "confirmed_at": "2026-09-25T10:00:00+00:00"}
        )

        groceries.update(edited)

        row = groceries.get(key)
        assert row is not None
        assert (row.name_es, row.aisle, row.is_pantry, row.default_unit) == ("Nuevo", Aisle.CANNED, True, "g")
        assert row.confirmed_at is not None

    def test_delete_removes_the_row_once(self, groceries: PostgresGroceryRepository, key: str) -> None:
        groceries.upsert_many([_row(key, Aisle.OTHER)])

        assert groceries.delete(key) is True
        assert groceries.get(key) is None
        assert groceries.delete(key) is False


class TestAPersonsAisleOutlivesTheSeed:
    def test_set_aisle_moves_and_confirms(self, groceries: PostgresGroceryRepository, key: str) -> None:
        groceries.upsert_many([_row(key, Aisle.OTHER)])

        moved = groceries.set_aisle(key, Aisle.HOUSEHOLD)

        assert moved is not None
        assert moved.aisle == Aisle.HOUSEHOLD
        assert moved.confirmed_at is not None

    def test_re_seeding_leaves_a_confirmed_row_entirely_alone(self, groceries: PostgresGroceryRepository, key: str) -> None:
        """Not just its aisle: an admin's rename has to outlive the deploy too."""
        groceries.upsert_many([_row(key, Aisle.OTHER)])
        groceries.set_aisle(key, Aisle.HOUSEHOLD)

        groceries.upsert_many([_row(key, Aisle.OTHER, name_en="renamed")])

        row = groceries.get(key)
        assert row is not None
        assert row.aisle == Aisle.HOUSEHOLD
        assert row.name_en == key

    def test_re_seeding_still_moves_an_unconfirmed_aisle(self, groceries: PostgresGroceryRepository, key: str) -> None:
        groceries.upsert_many([_row(key, Aisle.OTHER)])

        groceries.upsert_many([_row(key, Aisle.CANNED)])

        assert groceries.get(key).aisle == Aisle.CANNED  # type: ignore[union-attr]

    def test_a_row_born_confirmed_is_stored_confirmed(self, groceries: PostgresGroceryRepository, key: str) -> None:
        """A hand-filed row arrives through `upsert_many` with `confirmed_at` set.
        Dropping it on insert would leave the row unprotected from the next seed."""
        groceries.upsert_many([_row(key, Aisle.HOUSEHOLD, source=GrocerySource.HUMAN, confirmed_at="2026-09-25T10:00:00+00:00")])

        assert groceries.get(key).confirmed_at is not None  # type: ignore[union-attr]

    def test_a_missing_row_is_none(self, groceries: PostgresGroceryRepository) -> None:
        assert groceries.get(f"nope {uuid.uuid4()}") is None
        assert groceries.set_aisle(f"nope {uuid.uuid4()}", Aisle.OTHER) is None
