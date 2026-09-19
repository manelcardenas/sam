import type { Aisle, GroceryItem, ShoppingListItem } from "@/lib/api-client";
import { normaliseName } from "@/lib/plan-ingredients";

/**
 * Reading the shopping list the way you walk the shop
 * (docs/plans/ingredient-capture-plan.md §3.3, §6).
 *
 * **Everything here degrades to today's behaviour when the vocabulary is
 * missing.** The list is the thing you hold in a supermarket; it must render
 * from the plan alone, whether the vocabulary has not loaded yet, failed, or
 * simply has no row for what you typed. So an unmatched line is not an error —
 * it lands in `other` and sorts last, which is where an unrecognised thing
 * belongs anyway.
 */

/**
 * The order you walk the shop. **Not alphabetical**, and not sorted at runtime:
 * this array *is* the order, mirroring `domain/entities/grocery.py::Aisle`.
 *
 * Sorting these by name would open the list with `bakery` and drop `other` into
 * the middle — the same trap `meal_plan._MEAL_ORDER` documents on the backend
 * after `"dinner" < "lunch"` rendered every day upside down.
 */
export const AISLES: readonly Aisle[] = [
  "produce",
  "bakery",
  "meat_fish",
  "dairy_eggs",
  "frozen",
  "canned",
  "dry_goods",
  "condiments",
  "drinks",
  "household",
  "other",
] as const;

const AISLE_ORDER = new Map<Aisle, number>(AISLES.map((aisle, index) => [aisle, index]));

export function aisleOrder(aisle: Aisle): number {
  return AISLE_ORDER.get(aisle) ?? AISLE_ORDER.size;
}

/** The vocabulary keyed the way the shopping list normalises, for O(1) lookup. */
export function byKey(items: GroceryItem[]): Map<string, GroceryItem> {
  return new Map(items.map((item) => [item.key, item]));
}

/** Lowercase, collapse whitespace, strip diacritics — `normalise_ingredient_name`. */
function normalise(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .split(/\s+/)
    .join(" ");
}

/**
 * The vocabulary key a written name means, in any of the three languages.
 *
 * **The client's copy of `resolve_grocery_key`**, and it only exists so the
 * *"already on the list: 3"* annotation can be truthful before the write
 * happens. The server decides what actually merges; if this disagrees, the
 * annotation points at a different row than the one that receives the amount —
 * which is worse than no annotation, because it is confidently wrong.
 *
 * Built by scanning rather than indexed: it runs over one recipe's ingredients
 * inside an open sheet, a few hundred rows against a dozen names.
 */
export function resolveKey(name: string, vocabulary: Map<string, GroceryItem>): string | null {
  const wanted = normalise(name);
  for (const item of vocabulary.values()) {
    if (item.key === wanted) return item.key;
    if (normalise(item.name_es) === wanted || normalise(item.name_ca) === wanted || normalise(item.name_en) === wanted) return item.key;
  }
  return null;
}

/**
 * The name in the reader's language, falling back to Spanish.
 *
 * Spanish rather than English because the vocabulary is written in it and it is
 * what gets typed — mirrors `GroceryItem.name_for` on the backend.
 */
export function nameFor(item: GroceryItem, locale: string): string {
  if (locale === "ca") return item.name_ca || item.name_es;
  if (locale === "en") return item.name_en || item.name_es;
  return item.name_es;
}

/**
 * Which vocabulary row a list line means, if any.
 *
 * **`grocery_key` first, the normalised name only as a fallback.** The server
 * resolves the key on write against all three names, which is the whole point:
 * the key is `key_for(name_es)`, so matching on the name alone only ever finds
 * rows typed in Spanish — 87% of Catalan names and 92% of English ones
 * normalise differently from their own key, and every one of those lines
 * silently landed in `Otros`.
 *
 * The fallback is what keeps **legacy lines needing no migration**: a line
 * written months ago reading `huevos` has no key and still finds the `huevos`
 * row, exactly as it did before.
 */
export function groceryFor(item: ShoppingListItem, vocabulary: Map<string, GroceryItem>): GroceryItem | undefined {
  return vocabulary.get(item.grocery_key ?? item.normalised_name);
}

/**
 * How a list line should read, in the reader's own language.
 *
 * A matched line renders from the vocabulary, so one merged line shows as
 * `Cebolla` to you and `Ceba` to whoever else is in the kitchen — which is the
 * payoff for merging across languages in the first place. An unmatched line
 * keeps the words somebody actually typed.
 */
export function displayName(item: ShoppingListItem, vocabulary: Map<string, GroceryItem>, locale: string): string {
  const match = groceryFor(item, vocabulary);
  return match ? nameFor(match, locale) : item.display_name;
}

export interface AisleGroup {
  aisle: Aisle;
  items: ShoppingListItem[];
}

/**
 * Group lines into the aisles they are found in, in walking order.
 *
 * Empty aisles are dropped rather than rendered as empty headings — a shop you
 * have nothing to buy in is not a stop on the route. Within a group, the order
 * the server sent is preserved: that is already `normalised_name`, so each
 * section reads alphabetically without sorting twice.
 */
export function groupByAisle(items: ShoppingListItem[], vocabulary: Map<string, GroceryItem>): AisleGroup[] {
  const buckets = new Map<Aisle, ShoppingListItem[]>();

  for (const item of items) {
    const aisle = groceryFor(item, vocabulary)?.aisle ?? "other";
    const bucket = buckets.get(aisle);
    if (bucket) bucket.push(item);
    else buckets.set(aisle, [item]);
  }

  return AISLES.filter((aisle) => buckets.has(aisle)).map((aisle) => ({ aisle, items: buckets.get(aisle) ?? [] }));
}

/**
 * Autocomplete for the manual-add box.
 *
 * Matches across **all three** names, not just the reader's: typing `eggs` with
 * the app in Spanish should still find `Huevos`, because the two are the same
 * row and the point of the vocabulary is that they end up as one line.
 *
 * Prefixes rank above substrings — typing `pa` offers `Pan` before `Pasta de
 * dientes` — and beyond that the server's key order is kept, so the list does
 * not reshuffle as you type a second letter.
 */
export function suggest(query: string, items: GroceryItem[], limit = 6): GroceryItem[] {
  const needle = normaliseName(query);
  if (!needle) return [];

  const prefixes: GroceryItem[] = [];
  const contains: GroceryItem[] = [];

  for (const item of items) {
    // `item.key` is already the normalised Spanish name, so it needs no work.
    const haystacks = [item.key, normaliseName(item.name_ca), normaliseName(item.name_en)];
    if (haystacks.some((name) => name.startsWith(needle))) prefixes.push(item);
    else if (haystacks.some((name) => name.includes(needle))) contains.push(item);
  }

  return [...prefixes, ...contains].slice(0, limit);
}
