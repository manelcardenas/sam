import type { Recipe } from "@/lib/api-client";
import { FOOD_TYPES, type FoodType } from "@/lib/constants";

/**
 * Narrowing a list of recipes — the logic behind the chip row, shared by
 * `/dashboard` and the planner's slot picker.
 *
 * **Why this is one module.** The two surfaces ask the same question of the same
 * collection: *which of my recipes am I looking for?* They had drifted into two
 * answers — `/dashboard` had a search box and category chips, the picker had a
 * search box and nothing — so a filter added to one silently did not exist on
 * the other. Everything here is pure, so both callers get the same semantics and
 * the semantics are testable without rendering either page.
 *
 * **What is deliberately not shared is the selection.** The picker opens with
 * nothing narrowed, every time. Carrying `/dashboard`'s chips into a bottom sheet
 * would open it showing three of your recipes because of something you tapped on
 * another page, with the cause off-screen.
 *
 * The axes combine as **AND across kinds, OR within one**: "a postre, by Manel or
 * Martina, matching 'tarta'". That is the only combination people mean — nobody
 * looks for something that is simultaneously a postre and an aperitivo.
 */

export interface RecipeFilterState {
  /** Free-text on the title. Trimmed and case-folded at match time, not here. */
  q: string;
  category: FoodType | null;
  /** `created_by` ids, OR-ed together. Empty means "anyone". */
  authors: string[];
}

export const NO_FILTERS: RecipeFilterState = { q: "", category: null, authors: [] };

export interface RecipeAuthor {
  id: string;
  name: string;
}

/**
 * The people who wrote the given recipes: you first, then everyone else by name.
 *
 * Derived from the loaded list rather than fetched, which needs no endpoint and
 * gets the no-dead-end rule for free — somebody with no recipes cannot appear,
 * so no chip can select nothing.
 *
 * You lead because it is your collection and "mine" is the filter you reach for
 * most; the rest are sorted with `localeCompare` so Catalan and Spanish names
 * with accents sort where a reader expects rather than after Z.
 *
 * An author whose `created_by_name` is missing is left out: a chip needs a label,
 * and inventing one ("Unknown") would offer a filter for a person rather than
 * for a gap in the data. Their recipes still appear in the unfiltered list.
 */
export function authorsOf(recipes: Recipe[], currentUserId: string | null, locale: string): RecipeAuthor[] {
  const byId = new Map<string, string>();
  for (const recipe of recipes) {
    if (recipe.created_by_name && !byId.has(recipe.created_by)) {
      byId.set(recipe.created_by, recipe.created_by_name);
    }
  }

  const authors = [...byId].map(([id, name]) => ({ id, name }));
  return authors.sort((a, b) => {
    if (a.id === currentUserId) return -1;
    if (b.id === currentUserId) return 1;
    return a.name.localeCompare(b.name, locale);
  });
}

/**
 * The categories that actually have something behind them.
 *
 * The Bebida rule from the UX refresh: a chip that can only ever return an empty
 * list is a dead end. Returned in `FOOD_TYPES` order rather than by count, so the
 * row does not reshuffle itself as the collection grows.
 */
export function categoriesOf(recipes: Recipe[]): (typeof FOOD_TYPES)[number][] {
  return FOOD_TYPES.filter((c) => recipes.some((r) => r.food_type === c.value));
}

export function filterRecipes(recipes: Recipe[], { q, category, authors }: RecipeFilterState): Recipe[] {
  const needle = q.trim().toLowerCase();
  return recipes.filter(
    (r) =>
      (!category || r.food_type === category) &&
      // Empty means "anyone", not "nobody" — the same default-to-everything rule
      // a null category follows. Inverting this shows an empty page until you
      // pick someone, which reads as the app having lost your recipes.
      (authors.length === 0 || authors.includes(r.created_by)) &&
      (!needle || r.title.toLowerCase().includes(needle)),
  );
}

/** Whether anything is narrowing the list — what the Clear chip keys off. */
export function isNarrowed({ q, category, authors }: RecipeFilterState): boolean {
  return Boolean(q.trim() || category || authors.length > 0);
}

/** Multi-select: tapping a selected author unselects them. */
export function toggleAuthor(authors: string[], id: string): string[] {
  return authors.includes(id) ? authors.filter((a) => a !== id) : [...authors, id];
}
