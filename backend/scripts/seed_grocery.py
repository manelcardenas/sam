"""Load the starter grocery vocabulary — docs/plans/ingredient-capture-plan.md §3.6, Phase A.

HOW TO RUN
----------
From `backend/`, with the target database in the environment:

    uv run alembic upgrade head
    uv run python -m scripts.seed_grocery

**Idempotent and safe to re-run.** Rows are upserted on `key`, so adding entries
to `grocery_seed_data.py` and running this again adds exactly those entries.
`created_at` and `confirmed_at` are never overwritten, so re-running cannot erase
the fact that a person vouched for a row or backdate one somebody added by hand.

Unlike `scripts/seed.py` this is **not dev fixture data** — it is reference data
the app needs in every environment, the same way `cuisines` is. It is separate
from `seed.py` for that reason: one of them invents restaurants for local
development, the other is production vocabulary.
"""

from __future__ import annotations

import sys

from dotenv import load_dotenv

from scripts.grocery_seed_data import SEED
from src.domain.entities import GroceryItem, GrocerySource, key_for
from src.infra.adapters.repos import PostgresGroceryRepository
from src.infra.db import DatabaseConnectionPool, build_dsn

# Standalone entry point: nothing has loaded the environment yet. `src/main.py`
# does this for the app, and these scripts used to inherit it by being imported
# from there — so `uv run python -m scripts.<name>`, the way both docstrings say
# to run them, died on a missing POSTGRES_HOST. `tests/unit/test_scripts_load_env.py`
# now fails if a script that reads the database forgets this.
load_dotenv()



def build_items() -> list[GroceryItem]:
    """Turn the seed table into entities, refusing to proceed on a key collision.

    Two rows can normalise to the same key without looking alike in the source
    — accents and case are stripped — and an upsert would silently let the
    second quietly overwrite the first. Failing loudly here is the difference
    between noticing in a seed run and noticing when a shopping list merges two
    unrelated ingredients.
    """
    items: list[GroceryItem] = []
    seen: dict[str, str] = {}

    for aisle, rows in SEED.items():
        for name_es, name_ca, name_en, default_unit, is_pantry in rows:
            key = key_for(name_es)
            if key in seen:
                raise ValueError(f"Duplicate grocery key {key!r}: {seen[key]!r} and {name_es!r}")
            seen[key] = name_es
            items.append(
                GroceryItem(
                    key=key,
                    name_es=name_es,
                    name_ca=name_ca,
                    name_en=name_en,
                    aisle=aisle,
                    is_pantry=is_pantry,
                    default_unit=default_unit,
                    source=GrocerySource.SEED,
                )
            )

    return items


def run() -> None:
    """Load the vocabulary into the configured database. Named `run` to match
    `scripts.seed`, so `src/main.py` calls both the same way."""
    items = build_items()
    pool = DatabaseConnectionPool(build_dsn())
    written = PostgresGroceryRepository(pool.session_factory).upsert_many(items)
    print(f"Seeded {written} grocery items across {len(SEED)} aisles.")


def main() -> int:
    run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
