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
  /** Sometimes goes in: starts unticked (ADR 0009 §2). */
  optional: boolean;
}

/**
 * Whether a line goes on the list, given which ones the person flipped.
 *
 * Every line starts in its default — ticked, or unticked when the recipe calls
 * it optional — and a tap flips it. Storing the flips rather than the ticks is
 * what lets one set mean the right thing for both kinds.
 */
export function isTicked(line: Pick<ScaledLine, "id" | "optional">, flipped: Set<string>): boolean {
  return line.optional ? flipped.has(line.id) : !flipped.has(line.id);
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
      optional: Boolean(item.optional),
    };
  });
}


/**
 * The unit a list line is stored in — the client's copy of the backend's
 * `canonical_unit` (ADR 0009 §5). Weights become grams and volumes
 * millilitres, so a recipe's 1 kg finds the list's 500 g; anything else is
 * kept as written. The two copies must agree, or the popup's "already on the
 * list" points at a different line than the one the server merges into.
 */
const CONVERSIONS: Record<string, [string, number]> = {
  ...Object.fromEntries(["g", "gr", "grs", "gramo", "gramos"].map((u) => [u, ["g", 1] as [string, number]])),
  ...Object.fromEntries(["kg", "kgs", "kilo", "kilos", "kilogramo", "kilogramos"].map((u) => [u, ["g", 1000] as [string, number]])),
  ...Object.fromEntries(["ml", "mililitro", "mililitros"].map((u) => [u, ["ml", 1] as [string, number]])),
  ...Object.fromEntries(["cl", "centilitro", "centilitros"].map((u) => [u, ["ml", 10] as [string, number]])),
  ...Object.fromEntries(["l", "lt", "litro", "litros"].map((u) => [u, ["ml", 1000] as [string, number]])),
};

export function canonicalUnit(unit: string | null | undefined): { unit: string | null; factor: number } {
  const written = unit?.trim();
  if (!written) return { unit: null, factor: 1 };
  const base = CONVERSIONS[written.toLowerCase()];
  return base ? { unit: base[0], factor: base[1] } : { unit: written, factor: 1 };
}

/**
 * The list line this ingredient would merge into, if any.
 *
 * **This is the client's copy of the server's `merge_key`**, and the two have to
 * agree exactly: identity is the vocabulary key when there is one (so `Onion`
 * on the list is found for a recipe's `cebolla`), and the unit is compared
 * canonical and case-blind (so 1 kg finds 500 g, and `Lonchas` finds
 * `lonchas`).
 */
export function findExistingLine(
  items: ShoppingListItem[],
  line: Pick<ScaledLine, "key" | "unit">,
  groceryKey?: string | null,
): ShoppingListItem | undefined {
  const identity = groceryKey ?? line.key;
  const unit = (canonicalUnit(line.unit).unit ?? "").toLowerCase();
  return items.find((item) => (item.grocery_key ?? item.normalised_name) === identity && (canonicalUnit(item.unit).unit ?? "").toLowerCase() === unit);
}

/**
 * How the list shows a quantity, or null when there isn't one.
 *
 * Stored in grams and millilitres, shown in kilos and litres from 1000 up —
 * "1,5 kg" reads at the shelf, "1500 g" has to be worked out. With the
 * reader's locale, so Catalan and Spanish get their decimal comma.
 */
export function formatAmount(amount: number | null, unit: string | null, locale?: string): string | null {
  if (amount == null) return null;
  let value = amount;
  let shown = unit;
  if (unit === "g" && amount >= 1000) [value, shown] = [amount / 1000, "kg"];
  else if (unit === "ml" && amount >= 1000) [value, shown] = [amount / 1000, "l"];
  const number = locale ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value) : String(Math.round(value * 100) / 100);
  return `${number}${shown ? ` ${shown}` : ""}`;
}

/** List lines this slot put there. Drives the "already added?" tick on the week grid. */
export function linesFromEntry(items: ShoppingListItem[], entry: Pick<PlanEntry, "id">): ShoppingListItem[] {
  return items.filter((item) => item.sources.some((source) => source.entry_id === entry.id));
}
