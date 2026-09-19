"""Restructure the ingredient lines written before the parser existed — §9.1, Phase F.

THE PROBLEM (measured in production, 2026-09-06)
------------------------------------------------
Across 19 recipes and 111 ingredient lines, `amount` was filled on 2 and `unit`
on 1, while 56% of names *start with a digit*. People typed `"3 huevos"` into
the one box that was pleasant to fill in.

Three things are wrong with those lines. **Only two can be fixed by machine.**

    quantity hidden in the name   62 lines   the parser splits it
    no identity, so no aisle     111 lines   the matcher resolves it
    the recipe has no servings    79 lines   NOTHING. Deliberately.

The third is not an oversight. meal-planner-plan.md §3 already ruled on it —
*forcing a headcount onto a recipe written without one invents data* — and
`scaleIngredients` is already built to pass those amounts through at a factor of
1. A backfill that guessed `servings: 4` would turn "we don't know" into
confident wrong numbers on a shopping list. **This script never writes
`servings`.** Those recipes get one the next time somebody edits them.

HOW TO RUN
----------
From `backend/`, against whatever database `POSTGRES_DSN` (or the legacy
`POSTGRES_*` fields) resolves to — **this does not need a deploy**. What the
target database *does* need is `grocery_items` populated, which locally happens
automatically on `npm run dev` and in production happens in the deploy workflow.

    uv run python -m scripts.restructure_ingredients            # dry run — writes nothing
    uv run python -m scripts.restructure_ingredients --apply    # writes
    uv run python -m scripts.restructure_ingredients --only bolo

**Rehearse locally first.** `scripts/seed.py` deliberately mirrors the production
shape — quantities typed into the name, structured fields empty — so a local run
exercises the rewrite *and* the SKIPPED paths against real-looking mess.

**Dry run is the default and prints every proposed change.** Read it before
passing --apply. Against production, read it twice: this rewrites rows in place.
`--apply` writes the previous state to a timestamped JSON file first, so a bad
run is recoverable without a Neon branch restore.

THE INVARIANT: IT MUST CREATE ZERO VOCABULARY ROWS
--------------------------------------------------
§3.6 built the seed partly *from* these 111 lines, so by the time this runs
every name in them is already vocabulary. If the parser wants to invent a row,
that is **a signal, not a result** — either the seed missed something real or
the model is misreading a line, and both deserve a human look. So the grocery
repository is wrapped read-only here: nothing can be created, and any recipe
that tried is SKIPPED with the invented names printed.

That is the one behavioural difference from the app's own parse path, where
inventing a row is correct (a word somebody typed is a word the app has seen).
Here nobody is watching the screen, and a row invented at 2am by a misread line
is one that quietly sorts an ingredient into the wrong aisle forever.

WHAT ELSE IT REFUSES
--------------------
- **A recipe whose parse came back with fewer lines than went in.** More is
  normal and desirable: `"aceite, sal, pimienta"` is one line in and three out.
  Fewer means something was dropped, and a silently shorter ingredient list is
  the one failure nobody notices until they are already cooking.
- **A recipe that is already structured** — every name resolves to a vocabulary
  key — is skipped before any API call, so re-running costs nothing. That is
  what makes this idempotent: fix the handful it skipped by hand, run it again,
  and only the fixed ones are touched.

WHY THE NAME BECOMES THE SPANISH ONE
------------------------------------
Recipes store a display *name*, not a key, so one has to be chosen. `name_es` is
the vocabulary's canonical spelling and the one its keys are derived from. The
shopping list no longer cares — it resolves all three languages (§6.1) — so this
is about the recipe reading consistently, not about matching. A future phase
could store the key on the line and render it localised; it is not this one.

COST
----
One request per unstructured recipe. 19 recipes is about **1.5 cents**.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from src.app.use_cases import ParseIngredients
from src.domain.entities import GroceryItem, IngredientParserError, key_for
from src.domain.entities.parsed_ingredient import ResolvedLine
from src.domain.ports import GroceryRepository
from src.infra.adapters.parsing import build_ingredient_parser
from src.infra.adapters.repos import PostgresGroceryRepository
from src.infra.db import DatabaseConnectionPool, RecipeModel, build_dsn

# Standalone entry point: nothing has loaded the environment yet. `src/main.py`
# does this for the app, and these scripts used to inherit it by being imported
# from there — so `uv run python -m scripts.<name>`, the way both docstrings say
# to run them, died on a missing POSTGRES_HOST. `tests/unit/test_scripts_load_env.py`
# now fails if a script that reads the database forgets this.
load_dotenv()


class ReadOnlyGroceryRepository(GroceryRepository):
    """The vocabulary, with writes recorded instead of performed.

    `ParseIngredients` creates rows for anything the model proposes, which is
    right in the app and wrong here — see the invariant in the module docstring.
    Wrapping rather than branching inside the use case keeps that decision where
    it belongs: in the caller that knows nobody is watching.
    """

    def __init__(self, inner: GroceryRepository) -> None:
        self.inner = inner
        self.refused: list[GroceryItem] = []

    def list_all(self) -> list[GroceryItem]:
        return self.inner.list_all()

    def upsert_many(self, items: list[GroceryItem]) -> int:
        self.refused.extend(items)
        return 0


@dataclass
class Report:
    rewritten: int = 0
    recipes: int = 0
    already_fine: int = 0
    skipped: list[str] = field(default_factory=list)
    invented: set[str] = field(default_factory=set)


def is_structured(items: list[dict], vocabulary: dict[str, GroceryItem]) -> bool:
    """Whether this recipe already speaks the vocabulary's language.

    One cheap test, no API call: does every name resolve to a key? A line still
    reading `400g espaguetis` cannot, because the amount is inside the name —
    which is precisely the condition being fixed. A line reading `sal` resolves
    and is finished, quantity or not.
    """
    return bool(items) and all(key_for((item.get("name") or "").strip()) in vocabulary for item in items)


def as_item(line: ResolvedLine) -> dict:
    """One resolved line, in the shape `recipes.ingredients.items` stores.

    `amount`/`unit` stay absent rather than null when there is none: `sal` has no
    quantity, and ADR-0001's scaling already treats absence as "pass through".
    """
    item: dict = {"name": line.item.name_es}
    if line.amount is not None:
        item["amount"] = line.amount
    if line.unit:
        item["unit"] = line.unit
    return item


def as_text(item: dict) -> str:
    """One stored line, back as the sentence a cook would have typed.

    **Sending only `name` lost data.** Production's `Magdalenas de anís` held
    `{"name": "azúcar", "amount": 250, "unit": "Gr"}` — one of the two lines the
    2026-09-06 count found with the structured fields actually filled — and it
    came back as `Azúcar` with no quantity, because the parser was never shown
    the 250. The "fewer lines out than in" guard cannot see it: the line is still
    there, just emptier.

    **The name wins when it carries a digit.** `{"name": "6 huevos", "amount": 6}`
    is the same six written twice; prepending would send `6 6 huevos`. So the
    stored fields are used only when the name has no number of its own, which is
    exactly the case where they are the only copy.
    """
    name = str(item.get("name") or "").strip()
    amount = item.get("amount")
    if amount is None or any(character.isdigit() for character in name):
        return name
    return " ".join(part for part in (f"{amount:g}", str(item.get("unit") or "").strip(), name) if part)


def describe(before: list[dict], after: list[dict]) -> list[str]:
    """The change, as a reviewer needs to read it.

    Both lists in full rather than a per-line diff: the counts are allowed to
    differ (`"aceite, sal, pimienta"` is one line in and three out), so there is
    no honest pairing to draw. Side by side, a person checks it in two seconds.
    """
    lines = ["  before"]
    lines += [f"    {item.get('name') or ''}" for item in before]
    lines.append("  after")
    for item in after:
        amount = f"{item['amount']:g}" if "amount" in item else ""
        lines.append(f"    {item['name']:<28} {amount:>7} {item.get('unit', '')}".rstrip())
    return lines


def run(apply: bool, only: str | None) -> int:
    parser = build_ingredient_parser()
    db = DatabaseConnectionPool(dsn=build_dsn())
    db.open()

    report = Report()
    backup: dict[str, dict] = {}

    with db.session_factory() as session:
        groceries = ReadOnlyGroceryRepository(PostgresGroceryRepository(db.session_factory))
        vocabulary = {item.key: item for item in groceries.list_all()}
        if not vocabulary:
            print("The grocery vocabulary is empty. Run `uv run python -m scripts.seed_grocery` first.")
            return 1

        query = select(RecipeModel).order_by(RecipeModel.title)
        for recipe in session.scalars(query):
            if only and only.lower() not in recipe.title.lower():
                continue

            ingredients = recipe.ingredients or {}
            items = list(ingredients.get("items") or [])
            if not items:
                continue

            if is_structured(items, vocabulary):
                report.already_fine += 1
                continue

            text = "\n".join(line for item in items if (line := as_text(item)))
            before = len(groceries.refused)
            try:
                resolved = ParseIngredients(parser, groceries).execute(text, ingredients.get("servings") or 1)
            except IngredientParserError as error:
                # Stop rather than skip: every remaining recipe would fail the
                # same way, and a run that "skipped 18 of 19" reads like a data
                # problem instead of an unreachable provider.
                print(f"\nThe parser is unreachable ({error}). Nothing was written — try again later.")
                return 1

            invented = groceries.refused[before:]
            if invented:
                names = ", ".join(sorted(item.name_es for item in invented))
                report.skipped.append(f"{recipe.title!r}: parser wanted {len(invented)} new vocabulary row(s) — {names}")
                report.invented.update(item.name_es for item in invented)
                continue

            if len(resolved.lines) < len(items):
                report.skipped.append(f"{recipe.title!r}: {len(items)} lines in, {len(resolved.lines)} out — something was dropped")
                continue

            after = [as_item(line) for line in resolved.lines]
            print(f"\n{recipe.title}")
            print("\n".join(describe(items, after)))

            backup[str(recipe.id)] = {"title": recipe.title, "ingredients": ingredients}
            report.recipes += 1
            report.rewritten += len(after)

            if apply:
                # `servings` is carried through untouched, present or absent —
                # see the docstring. Only `items` is replaced.
                recipe.ingredients = {**ingredients, "items": after}
                # JSONB reassignment SQLAlchemy can see, but the flag costs
                # nothing and survives someone later mutating in place.
                flag_modified(recipe, "ingredients")

        if apply and backup:
            path = Path(f"restructure-backup-{datetime.now(UTC):%Y%m%dT%H%M%SZ}.json")
            path.write_text(json.dumps(backup, ensure_ascii=False, indent=2))
            print(f"\nPrevious state written to {path} — keep it until you have checked the recipes.")
            session.commit()

    db.close()

    if report.skipped:
        print("\nSKIPPED — these need a person:")
        for note in report.skipped:
            print(f"  {note}")
    if report.invented:
        print(
            f"\n  ⚠ The parser proposed {len(report.invented)} name(s) the vocabulary does not hold. "
            "By §9.1 that is a signal: either the seed is missing something real, or a line is being "
            "misread. Add the genuine ones to scripts/grocery_seed_data.py, re-seed, and run this again."
        )

    verb = "APPLIED" if apply else "DRY RUN"
    print(f"\n{verb}: {report.rewritten} lines across {report.recipes} recipes, {report.already_fine} already structured, {len(report.skipped)} skipped")
    if not apply and report.recipes:
        print("Nothing was written. Re-run with --apply once the list above looks right.")
    return 0


def main() -> int:
    argv = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    argv.add_argument("--apply", action="store_true", help="write the changes (default is a dry run)")
    argv.add_argument("--only", metavar="TEXT", help="only recipes whose title contains this — for re-running one you have just fixed")
    args = argv.parse_args()
    return run(apply=args.apply, only=args.only)


if __name__ == "__main__":
    sys.exit(main())
