import type { Aisle, DraftIngredient, GroceryItem, IngredientsData, IngredientsInput, ProposedGroceryItem, RecipeDraft } from "@/lib/api-client";
import { nameFor } from "@/lib/grocery";
import { normaliseName } from "@/lib/plan-ingredients";

/**
 * The rows of the recipe review, and everything that happens to them that is
 * not drawing: scaling, splitting, counting, comparing two readings
 * (docs/plans/meal-plan-phase-1.md §1.3).
 *
 * Kept out of the components so each rule is one tested function — the
 * guarantees the person relies on ("no line is lost", "the undo puts back
 * exactly what was there") are too easy to break in a render.
 */

export interface ReviewRow {
  id: number;
  /** Which source line this came from — several rows can share one. Absent on a row added by hand. */
  line?: number;
  /** That line's own words, shown under the row ("de: 1 cebolla grande picada"). */
  sourceLine?: string;
  name: string;
  /** Strings, because they are what the inputs hold; `""` is "no amount". */
  amount: string;
  unit: string;
  optional: boolean;
  /** The vocabulary row this is — dropped the moment the name is edited by hand. */
  groceryKey?: string;
  aisle?: Aisle;
  isPantry?: boolean;
  /** g, ml, or absent for something counted. */
  defaultUnit?: string;
  /** A product the vocabulary would gain on save. Kept only while the name still says what the proposal says. */
  newItem?: ProposedGroceryItem;
  didYouMean?: string[];
  /** "≈ 800 g" for "4 patatas". Offered once; accepting or editing the amount spends it. */
  gramsSuggestion?: number;
  /** The model skipped the line and the server put it back with its own words. */
  restored?: boolean;
}

/** At most two decimals and no trailing zeros, as on the list: 66.67, not 66.66666666666667. */
export function tidy(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function rowsFromDraft(draft: RecipeDraft, locale: string, nextId: () => number): ReviewRow[] {
  return draft.ingredients.map((row) => rowFromDraft(row, locale, nextId()));
}

function rowFromDraft(row: DraftIngredient, locale: string, id: number): ReviewRow {
  const known = row.item;
  const proposal = row.new_item;
  return {
    id,
    line: row.line,
    sourceLine: row.source_line,
    name: known ? nameFor(known, locale) : proposal ? proposalName(proposal, locale) : row.name,
    amount: row.amount != null ? String(tidy(row.amount)) : "",
    unit: row.unit ?? "",
    optional: row.optional,
    groceryKey: known?.key,
    aisle: known?.aisle ?? proposal?.aisle,
    isPantry: known?.is_pantry ?? proposal?.is_pantry,
    defaultUnit: (known?.default_unit ?? proposal?.default_unit) || undefined,
    newItem: proposal ?? undefined,
    didYouMean: row.did_you_mean,
    gramsSuggestion: row.grams_suggestion ?? undefined,
    restored: row.restored,
  };
}

function proposalName(proposal: ProposedGroceryItem, locale: string): string {
  return { ca: proposal.name_ca, en: proposal.name_en }[locale] || proposal.name_es;
}

/** A saved recipe's ingredients, as rows to edit. Matched to the vocabulary by name, as the list matches them. */
export function rowsFromRecipe(ingredients: IngredientsData | undefined, vocabulary: Map<string, GroceryItem>, nextId: () => number): ReviewRow[] {
  return (ingredients?.items ?? []).map((item) => {
    const known = findByName(item.name, vocabulary);
    return {
      id: nextId(),
      name: item.name,
      amount: item.amount != null ? String(tidy(item.amount)) : "",
      unit: item.unit ?? "",
      optional: Boolean(item.optional),
      groceryKey: known?.key,
      aisle: known?.aisle,
      isPantry: known?.is_pantry,
      defaultUnit: known?.default_unit ?? undefined,
    };
  });
}

/** The vocabulary row a written name means, in any of its three languages. */
export function findByName(name: string, vocabulary: Map<string, GroceryItem>): GroceryItem | undefined {
  const needle = normaliseName(name);
  if (!needle) return undefined;
  const direct = vocabulary.get(needle);
  if (direct) return direct;
  for (const item of vocabulary.values()) {
    if (normaliseName(item.name_ca) === needle || normaliseName(item.name_en) === needle) return item;
  }
  return undefined;
}

/** A row pointed at a vocabulary product the person picked — from the suggestions while typing. */
export function withProduct(row: ReviewRow, item: GroceryItem, locale: string): ReviewRow {
  return {
    ...row,
    name: nameFor(item, locale),
    groceryKey: item.key,
    aisle: item.aisle,
    isPantry: item.is_pantry,
    defaultUnit: item.default_unit ?? undefined,
    newItem: undefined,
    didYouMean: [],
    restored: false,
  };
}

/**
 * The name typed by hand: whatever the row pointed at no longer describes it.
 *
 * Unless it is the vocabulary's own name for it, typed back — then it is the
 * same product, and losing its aisle over a round trip would be silly.
 */
export function withName(row: ReviewRow, name: string, vocabulary: Map<string, GroceryItem>): ReviewRow {
  const known = findByName(name, vocabulary);
  if (known) {
    return { ...row, name, groceryKey: known.key, aisle: known.aisle, isPantry: known.is_pantry, defaultUnit: known.default_unit ?? undefined, newItem: undefined, restored: false };
  }
  const keepsProposal = row.newItem && [row.newItem.name_es, row.newItem.name_ca, row.newItem.name_en].some((n) => normaliseName(n) === normaliseName(name));
  return {
    ...row,
    name,
    groceryKey: undefined,
    aisle: keepsProposal ? row.aisle : undefined,
    isPantry: keepsProposal ? row.isPantry : undefined,
    defaultUnit: keepsProposal ? row.defaultUnit : undefined,
    newItem: keepsProposal ? row.newItem : undefined,
    didYouMean: [],
    restored: false,
  };
}

/** Accept "≈ 800 g": the count becomes a weight, and the suggestion is spent. */
export function acceptGrams(row: ReviewRow): ReviewRow {
  if (row.gramsSuggestion == null) return row;
  return { ...row, amount: String(row.gramsSuggestion), unit: "g", gramsSuggestion: undefined };
}

/** Words that join two ingredients on one line: "sal y pimienta", "sal i pebre", "salt and pepper". */
const JOINERS = /\s*(?:,|\s+y\s+|\s+i\s+|\s+and\s+|\s*&\s*|\s*\+\s*)\s*/i;

export function canSplit(row: ReviewRow): boolean {
  return row.name.split(JOINERS).filter((part) => part.trim()).length > 1;
}

/**
 * "sal y pimienta" → "sal", "pimienta", on the same source line.
 *
 * Each part is matched to the vocabulary by name; the amount is dropped,
 * because "2 sal y pimienta" never meant two of each and guessing which part it
 * belonged to would be inventing a number.
 */
export function splitRow(row: ReviewRow, vocabulary: Map<string, GroceryItem>, nextId: () => number): ReviewRow[] {
  const parts = row.name.split(JOINERS).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return [row];
  return parts.map((part) =>
    withName({ id: nextId(), line: row.line, sourceLine: row.sourceLine, name: part, amount: "", unit: "", optional: row.optional }, part, vocabulary),
  );
}

/**
 * The amounts for a new headcount (ADR 0009 §4): 5 → 3 turns 500 g into 300 g.
 *
 * Returns the previous amounts too, keyed by row, so the undo link ("No, las
 * cantidades ya eran para 3") can put back exactly those — and leave any row
 * the person has edited since, or added, alone.
 */
export function scaleRows(rows: ReviewRow[], from: number, to: number): { rows: ReviewRow[]; before: Map<number, string> } {
  const before = new Map<number, string>();
  if (from <= 0 || to <= 0 || from === to) return { rows, before };
  const scaled = rows.map((row) => {
    const amount = Number(row.amount.replace(",", "."));
    if (!row.amount.trim() || !Number.isFinite(amount)) return row;
    before.set(row.id, row.amount);
    // The grams offer scales with the count it is an estimate of.
    const grams = row.gramsSuggestion != null ? Math.round((row.gramsSuggestion / from) * to) : undefined;
    return { ...row, amount: String(tidy((amount / from) * to)), gramsSuggestion: grams };
  });
  return { rows: scaled, before };
}

/** Put back the amounts `scaleRows` replaced, on the rows that still hold what it wrote. */
export function unscaleRows(rows: ReviewRow[], before: Map<number, string>, scaled: Map<number, string>): ReviewRow[] {
  return rows.map((row) => (before.has(row.id) && scaled.get(row.id) === row.amount ? { ...row, amount: before.get(row.id) as string } : row));
}

export function hasAmounts(rows: ReviewRow[]): boolean {
  return rows.some((row) => row.amount.trim() !== "");
}

/**
 * What the counter says: how many source lines, how many rows, and whether any
 * line ended up with no row at all — which can only be the person's doing,
 * because the server never sends one.
 */
export function lineCount(rows: ReviewRow[], lines: number): { lines: number; rows: number; removed: number } {
  const covered = new Set(rows.flatMap((row) => (row.line == null ? [] : [row.line])));
  return { lines, rows: rows.filter((row) => row.name.trim()).length, removed: Math.max(0, lines - covered.size) };
}

/**
 * Products the method names that the ingredient list does not have.
 *
 * Matched on the vocabulary's names (Spanish and Catalan), whole words only, so
 * "pimiento" in the steps is found but "sal" inside "salsa" is not. Plurals are
 * tried with a trailing `s`/`es`. A suggestion: the warning says what it found
 * and offers to add it, nothing more.
 */
export function missingFromMethod(instructions: string, rows: ReviewRow[], vocabulary: GroceryItem[]): GroceryItem[] {
  const method = ` ${normaliseName(instructions).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  if (!method.trim()) return [];
  const have = new Set(rows.flatMap((row) => [row.groceryKey, normaliseName(row.name)].filter(Boolean) as string[]));
  const found: GroceryItem[] = [];
  for (const item of vocabulary) {
    if (have.has(item.key) || item.key === "agua") continue;
    const names = new Set([item.key, normaliseName(item.name_ca)].filter((n) => n.length >= 3));
    const mentioned = [...names].some((name) => [name, `${name}s`, `${name}es`].some((form) => method.includes(` ${form} `)));
    // "aceite" in the steps is covered by "aceite de oliva" in the list: a
    // more specific product of the same name is the one the cook meant.
    const covered = [...names].some((name) => have.has(name) || [...have].some((h) => ` ${h} `.includes(` ${name} `)));
    if (mentioned && !covered) found.push(item);
  }
  return found;
}

/**
 * Compare the rows on screen with a fresh reading of the text: what "Volver a
 * leer" would add and take away, by product (or by name when unmatched), so the
 * person decides before their edits are replaced.
 */
export function compareReadings(current: ReviewRow[], next: ReviewRow[]): { added: string[]; removed: string[] } {
  const identity = (row: ReviewRow) => row.groceryKey ?? normaliseName(row.name);
  const now = new Map(current.filter((r) => r.name.trim()).map((r) => [identity(r), r.name]));
  const then = new Map(next.filter((r) => r.name.trim()).map((r) => [identity(r), r.name]));
  return {
    added: [...then].filter(([key]) => !now.has(key)).map(([, name]) => name),
    removed: [...now].filter(([key]) => !then.has(key)).map(([, name]) => name),
  };
}

/**
 * The rows as the API stores them, with the proposals for products the
 * vocabulary should learn when this is saved. Empty names are dropped — a row
 * typed and then cleared is nothing.
 */
export function ingredientsPayload(rows: ReviewRow[], servings: number): IngredientsInput {
  return {
    servings,
    items: rows
      .filter((row) => row.name.trim())
      .map((row) => {
        const amount = Number(row.amount.replace(",", "."));
        return {
          name: row.name.trim(),
          amount: row.amount.trim() && Number.isFinite(amount) ? amount : undefined,
          unit: row.unit.trim() || undefined,
          optional: row.optional || undefined,
          new_item: row.groceryKey ? undefined : (row.newItem ?? undefined),
        };
      }),
  };
}
