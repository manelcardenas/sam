"""Backfill `amount` and `unit` on ingredient lines that hide them inside `name`.

THE PROBLEM (measured in production, 2026-09-06)
------------------------------------------------
Across 19 recipes and 111 ingredient lines, `amount` was filled on 2 and `unit`
on 1 — while 56% of names *start with a digit*. People type `"3 huevos"` into the
one box that is pleasant to fill in. The meal planner cannot merge `"3 huevos"`
and `"2 huevos"` into five eggs, because they are different strings.

See docs/plans/meal-planner-plan.md §3.

HOW TO RUN
----------
From `backend/`, with the target database in the environment:

    uv run python -m scripts.backfill_ingredients            # dry run — writes nothing
    uv run python -m scripts.backfill_ingredients --apply    # writes

**Dry run is the default and prints every proposed change.** Read it before
passing --apply. Against production, read it twice: this rewrites rows in place
and there is no undo beyond a Neon branch restore.

WHAT IT WILL AND WILL NOT DO
----------------------------
It is deliberately conservative. Anything it cannot parse with confidence is
left exactly as it is and listed under SKIPPED for a human to fix by hand —
`"sal"`, `"un chorrito de aceite"` and `"pimienta al gusto"` are not broken
rows, they are ingredients that genuinely have no quantity.

It never touches a line that already has an `amount` or a `unit`, so it is
idempotent and safe to re-run.

WHY NOT A MODEL
---------------
Parsing 111 rows with an LLM is more setup than the work, and it would be the
project's first recurring cost. The real fix for the *cause* — one pleasant box
beats three tedious ones — is natural ingredient capture, which is roadmap item
9 and post-v1. Build that and this script's job disappears: point it at the
existing rows once. This is the path that does not depend on that existing.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from src.infra.db import DatabaseConnectionPool, RecipeModel, build_dsn

# Units we recognise, mapped to the spelling stored. Plurals are folded to the
# singular so `"2 vasos"` and `"1 vaso"` merge on the shopping list.
#
# This is a hand-enumerated lookup table, NOT stemming — which is why it is safe
# here while plural-folding ingredient *names* is not (meal-planner-plan.md §8.3c).
# The set is closed and small, so nothing unexpected can be folded into it.
UNITS: dict[str, str] = {
    "g": "g", "gr": "g", "gramo": "g", "gramos": "g",
    "kg": "kg", "kilo": "kg", "kilos": "kg",
    "ml": "ml", "cl": "cl",
    "l": "l", "litro": "l", "litros": "l",
    "vaso": "vaso", "vasos": "vaso",
    "taza": "taza", "tazas": "taza",
    "cucharada": "cucharada", "cucharadas": "cucharada",
    "cucharadita": "cucharadita", "cucharaditas": "cucharadita",
    "diente": "diente", "dientes": "diente",
    "lata": "lata", "latas": "lata",
    "sobre": "sobre", "sobres": "sobre",
    "rama": "rama", "ramas": "rama",
    "hoja": "hoja", "hojas": "hoja",
    "loncha": "loncha", "lonchas": "loncha",
    "rodaja": "rodaja", "rodajas": "rodaja",
    "puñado": "puñado", "puñados": "puñado",
    "pizca": "pizca", "pizcas": "pizca",
}

# Only the leading number is matched here. An earlier version also tried to
# capture the unit as an optional group in the same pattern, and it was wrong in
# both directions: with "3 huevos" the optional group swallowed part of the name,
# and with "200g" it left "g" as the ingredient. An optional group next to `.+?`
# backtracks into whatever makes the match succeed, which is never what you want
# when the two groups mean different things.
#
# So: the regex finds the quantity, and the remainder is tokenised in Python
# against the closed UNITS table, where "is this a unit?" is a lookup rather
# than something the engine guesses.
#
# Accepts 3 · 1.5 · 1,5 · 1/2 — all four spellings appear in the data.
LEADING_AMOUNT = re.compile(r"^\s*(?P<amount>\d+(?:[.,]\d+)?(?:\s*/\s*\d+)?)\s*(?P<rest>.*)$")

# "200g DE harina" — the connector is noise once the unit is its own field.
CONNECTOR = re.compile(r"^(?:de|del|d')\s+", re.IGNORECASE)


@dataclass(frozen=True)
class Parsed:
    amount: float
    unit: str | None
    name: str


def parse_amount(raw: str) -> float | None:
    """`"1/2"` → 0.5, `"1,5"` → 1.5. None when it is not a number we trust."""
    raw = raw.strip()
    if "/" in raw:
        numerator, _, denominator = raw.partition("/")
        try:
            bottom = float(denominator.strip())
            return float(numerator.strip()) / bottom if bottom else None
        except ValueError:
            return None
    try:
        return float(raw.replace(",", "."))
    except ValueError:
        return None


def parse_line(name: str) -> Parsed | None:
    """Split a hand-typed ingredient name into (amount, unit, name).

    Returns None whenever the result would be a guess — an unparseable number,
    or nothing left over for the name. A line left alone is a line a human can
    still fix; a line mangled by a clever guess is one nobody notices.
    """
    match = LEADING_AMOUNT.match(name)
    if match is None:
        return None

    amount = parse_amount(match.group("amount"))
    if amount is None:
        return None

    rest = match.group("rest").strip()
    head, _, tail = rest.partition(" ")

    if head.lower() in UNITS:
        unit: str | None = UNITS[head.lower()]
        remainder = tail.strip()
    else:
        # An unrecognised word belongs to the name: "3 huevos grandes" must not
        # acquire a unit called "huevos".
        unit = None
        remainder = rest

    remainder = CONNECTOR.sub("", remainder).strip()
    if not remainder:
        return None  # "200g" on its own names no ingredient
    return Parsed(amount=amount, unit=unit, name=remainder)


def run(apply: bool) -> int:
    db = DatabaseConnectionPool(dsn=build_dsn())
    db.open()
    changed = skipped = untouched = 0

    with db.session_factory() as session:
        for recipe in session.scalars(select(RecipeModel).order_by(RecipeModel.title)):
            ingredients = recipe.ingredients or {}
            items = ingredients.get("items") or []
            edits: list[str] = []

            for item in items:
                if item.get("amount") is not None or item.get("unit") is not None:
                    untouched += 1
                    continue

                original = (item.get("name") or "").strip()
                parsed = parse_line(original)
                if parsed is None:
                    if original and original[0].isdigit():
                        # Starts with a digit but wouldn't parse — the only
                        # category actually worth a human's attention.
                        print(f"  SKIPPED  {recipe.title!r}: {original!r}")
                        skipped += 1
                    else:
                        untouched += 1
                    continue

                item["name"] = parsed.name
                item["amount"] = parsed.amount
                item["unit"] = parsed.unit
                unit = f" {parsed.unit}" if parsed.unit else ""
                edits.append(f"    {original!r}  →  {parsed.amount:g}{unit} {parsed.name!r}")
                changed += 1

            if edits:
                print(f"\n{recipe.title}")
                print("\n".join(edits))
                if apply:
                    # JSONB is mutated in place, which SQLAlchemy cannot detect
                    # on its own — without this the commit is a silent no-op.
                    flag_modified(recipe, "ingredients")

        if apply:
            session.commit()

    db.close()

    print(f"\n{'APPLIED' if apply else 'DRY RUN'}: {changed} lines rewritten, {skipped} skipped for review, {untouched} already fine")
    if not apply and changed:
        print("Nothing was written. Re-run with --apply once the list above looks right.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write the changes (default is a dry run)")
    return run(apply=parser.parse_args().apply)


if __name__ == "__main__":
    sys.exit(main())
