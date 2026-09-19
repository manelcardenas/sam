import type { IngredientsData, PlanEntry, ShoppingListItem } from "@/lib/api-client";

/**
 * Turning a recipe's ingredients into the lines a slot contributes to the list.
 *
 * This is ADR 0001's scaling rule — `amount / servings * wanted` — applied at
 * the moment the user confirms the popup. ADR 0001 says the scaled figure is
 * never written back to the *recipe*, and that still holds: what gets written
 * here is a shopping-list line, which is a record of what you decided to buy
 * (docs/plans/meal-planner-plan.md §4.5), not a second version of the recipe.
 */

export interface ScaledLine {
  /** Stable within one render, for checkbox state. Index-based because two
   *  lines can legitimately share a name and unit in a badly-typed recipe. */
  id: string;
  name: string;
  amount: number | null;
  unit: string | null;
  /** What to show on the right: "200 g", "3", or nothing at all. */
  label: string | null;
  /** The merge key's name half, so the popup can find the line already on the list. */
  key: string;
}

/**
 * Mirrors the backend's `normalise_ingredient_name`: lowercase, collapse
 * whitespace, strip diacritics. **No plural stemming** — the two have to agree
 * exactly, or the popup's "already on the list" annotation points at a
 * different row than the one the server will merge into.
 */
export function normaliseName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .split(/\s+/)
    .join(" ");
}

/** At most two decimals, and no trailing zeros: 66.67, not 66.66666666666667. */
function tidy(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function scaleIngredients(ingredients: IngredientsData, wanted: number): ScaledLine[] {
  const base = ingredients.servings;
  // A recipe with no stated headcount cannot be scaled — its amounts are sized
  // for an unknown number of people. Passing them through unchanged is the
  // honest option: inventing a divisor would produce confident wrong numbers,
  // and the 71% of production lines with no `servings` are exactly why the
  // planner asks for one on new entries rather than guessing for old ones.
  const factor = base && base > 0 ? wanted / base : 1;

  return ingredients.items.map((item, index) => {
    const amount = item.amount != null ? tidy(item.amount * factor) : null;
    const unit = item.unit ?? null;
    return {
      id: `${index}`,
      name: item.name,
      amount,
      unit,
      // Things with no quantity ("sal") get no label rather than a "0" or a
      // "1" — the absence is information, and it survives all the way to the
      // list line's null total.
      label: amount != null ? `${amount}${unit ? ` ${unit}` : ""}` : null,
      key: normaliseName(item.name),
    };
  });
}


/**
 * The list line this ingredient would merge into, if any.
 *
 * **This is the client's copy of the server's `merge_key`**, and the two have to
 * agree exactly. The popup uses it to show *"already on the list: 3"* before you
 * decide; the server uses its own to decide which row actually receives the
 * amount. If they disagree, the annotation points at a different row than the
 * one that gets updated — which is worse than no annotation, because it is
 * confidently wrong.
 *
 * `?? ""` on both sides is the `COALESCE(unit, '')` from the SQL index: a line
 * with no unit and a line with an empty unit are the same line, and most
 * household ingredients have no unit at all.
 *
 * `groceryKey` is the identity half of that same COALESCE, and passing the
 * vocabulary in is what keeps this honest across languages: without it, an
 * `Onion` line already on the list would not be found for a recipe's `cebolla`,
 * and the popup would say "new" about something it is about to merge into.
 */
export function findExistingLine(
  items: ShoppingListItem[],
  line: Pick<ScaledLine, "key" | "unit">,
  groceryKey?: string | null,
): ShoppingListItem | undefined {
  const identity = groceryKey ?? line.key;
  return items.find((item) => (item.grocery_key ?? item.normalised_name) === identity && (item.unit ?? "") === (line.unit ?? ""));
}

/** How the list shows a quantity, or null when there isn't one. */
export function formatAmount(amount: number | null, unit: string | null): string | null {
  if (amount == null) return null;
  return `${amount}${unit ? ` ${unit}` : ""}`;
}

/** List lines this slot put there. Drives the "already added?" tick on the week grid. */
export function linesFromEntry(items: ShoppingListItem[], entry: Pick<PlanEntry, "id">): ShoppingListItem[] {
  return items.filter((item) => item.sources.some((source) => source.entry_id === entry.id));
}
