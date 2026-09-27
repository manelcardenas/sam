import type { Aisle, GroceryItem, MealPlan, ShoppingListItem } from "@/lib/api-client";
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

/**
 * The line a hand-typed name just became, if it is one worth asking the model about.
 *
 * **Worth asking** means nothing already knows its aisle: no vocabulary row by
 * key, and none by name either (a legacy spelling the client
 * can already file for free). A ticked line is left alone — it only merged into
 * something already in the basket, and asking about it spends a call on a
 * decision nobody is waiting for.
 *
 * Found by normalised name rather than by diffing ids, because adding can merge
 * into a line that already existed — which has the old id, and is exactly the
 * line that needs filing if it was sitting in `Other`.
 */
export function lineToClassify(plan: MealPlan, typed: string, vocabulary: Map<string, GroceryItem>): ShoppingListItem | null {
  const wanted = normalise(typed);
  // "Nothing knows it" is judged against the vocabulary, not by `grocery_key`
  // being null: a line can hold the key of a row an admin has since deleted,
  // and that line is exactly as unfiled as one that never had a key.
  const line = plan.items.find((item) => item.normalised_name === wanted && !item.is_checked);
  if (!line || groceryFor(line, vocabulary)) return null;
  return line;
}

/**
 * A row the parser created that nobody has vouched for — what the admin panel
 * calls "to review", and where junk like `qwerty` collects.
 *
 * Only `ai` rows: a seeded row was curated and a hand-filed one was a person's
 * own decision, so neither is waiting on anybody.
 */
export function isUnreviewed(item: GroceryItem): boolean {
  return item.source === "ai" && !item.confirmed_at;
}

/**
 * The admin's ingredient list: narrowed to one aisle (or to "to review") and by
 * a search, **newest first**.
 *
 * Newest first because the reason to open the list is almost always something
 * that just appeared — the parser's latest guess, a typo somebody filed a
 * minute ago. The seed's 274 rows share one insert and would otherwise bury
 * them. Ties break on the key so the order does not shuffle between renders.
 *
 * The search matches all three names and the key, the same breadth as the
 * manual-add autocomplete: an admin reading in Spanish still finds `Ous`.
 */
export function narrowVocabulary(items: GroceryItem[], q: string, shelf: Aisle | "unreviewed" | null): GroceryItem[] {
  const needle = normaliseName(q);
  return items
    .filter((item) => (shelf === null ? true : shelf === "unreviewed" ? isUnreviewed(item) : item.aisle === shelf))
    .filter((item) => !needle || [item.key, item.name_es, item.name_ca, item.name_en].some((name) => normaliseName(name).includes(needle)))
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "") || a.key.localeCompare(b.key));
}

/** What the add box understood: the thing, and how much of it when it said. */
export interface TypedLine {
  name: string;
  amount: number | null;
  unit: string | null;
}

// The metric units a shopping list is written in, and the spellings people
// actually type for them. Nothing else: "2 bolsas de basura" is two of a thing
// called "bolsas de basura", not a unit of "bolsa" — and the parser, which
// knows cups and cloves, still runs behind this for anything it misses.
const UNITS: Record<string, string> = {
  g: "g",
  gr: "g",
  grs: "g",
  gramo: "g",
  gramos: "g",
  kg: "kg",
  kilo: "kg",
  kilos: "kg",
  ml: "ml",
  cl: "cl",
  l: "l",
  litro: "l",
  litros: "l",
};

// A number, maybe a unit straight after it (`500g`, `500 g`, `250 gr.`), then
// the name — skipping the "de" in `1 l de leche`. The lookahead insists on a
// name, so `4` on its own stays a line called "4".
const LEADING = new RegExp(`^(\\d+(?:[.,]\\d+)?)(?:\\s*(${Object.keys(UNITS).join("|")})\\b\\.?)?\\s+(?:de\\s+)?(?=\\S)`, "i");
const TRAILING = /\s+x\s?(\d+)$/i;

/**
 * Read the quantity out of what was typed into the add box — `4 manzanas
 * amarillas` is four of them, not a thing called "4 manzanas amarillas"
 * (meal-planner-plan §8.14).
 *
 * **Here, and instantly**, rather than left to the background parse: that one
 * takes seconds, needs a provider, and only runs for lines the vocabulary does
 * not know — so `4 huevos` never reached it at all, and the 4 was lost. The
 * model still runs afterwards for the aisle; it just no longer owns the number.
 *
 * Only what is unambiguous: a number first (`4 …`, `1,5 kg …`, `500g de …`),
 * or `x4` at the end. A number that is part of a name (`7up`, `100% zumo`) has
 * no space after it and is left alone; so is a zero, which is not a quantity.
 */
export function readQuantity(typed: string): TypedLine {
  const text = typed.trim().replace(/\s+/g, " ");
  const whole: TypedLine = { name: text, amount: null, unit: null };

  const trailing = TRAILING.exec(text);
  if (trailing) {
    const amount = Number(trailing[1]);
    const name = text.slice(0, trailing.index).trim();
    return amount > 0 && name ? { name, amount, unit: null } : whole;
  }

  const leading = LEADING.exec(text);
  if (!leading) return whole;
  const amount = Number(leading[1].replace(",", "."));
  const unit = leading[2];
  const name = text.slice(leading[0].length).trim();
  if (!(amount > 0) || !name) return whole;
  return { name, amount, unit: unit ? UNITS[unit.toLowerCase()] : null };
}
