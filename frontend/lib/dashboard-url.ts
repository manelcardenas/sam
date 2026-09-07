import { FOOD_TYPES, type FoodType } from "@/lib/constants";

/**
 * The /dashboard view state machine, as a query string.
 *
 * list      →  /dashboard                                (everything)
 *           →  /dashboard?category=comida                (narrowed)
 *           →  /dashboard?q=lasa&category=comida         (narrowed + searched)
 * detail    →  /dashboard?category=comida&recipe=<id>
 * edit      →  /dashboard?category=comida&recipe=<id>&mode=edit
 * add       →  /dashboard?mode=new
 *
 * **`category` is a filter, not a view** (docs/plans/ux-refresh-plan.md §2).
 * The page used to open on a four-tile category grid you tapped through to
 * reach a list — a full screen of navigation in front of 19 recipes, one tile
 * of which (Bebida) had never contained anything. `/dine` had already answered
 * this question differently, with chips (ADR 0005), so the two list pages ran
 * on two philosophies. Now they don't: there is one list, and `category`
 * narrows it.
 *
 * The state that disappeared was `view: "categories"`. A bare `/dashboard` is
 * now the list itself, which is also why it stays the canonical link.
 *
 * `category` is still kept alongside `recipe` so that backing out of a recipe
 * lands on the list you came from rather than on the unfiltered one.
 */

export type DashboardView = "list" | "detail" | "add" | "edit";

export interface DashboardUrlState {
  view: DashboardView;
  category: FoodType | null;
  recipeId: string | null;
  /** Free-text title search. Only meaningful on the list. */
  q: string;
}

export const INITIAL_STATE: DashboardUrlState = {
  view: "list",
  category: null,
  recipeId: null,
  q: "",
};

const VALID_CATEGORIES = new Set<string>(FOOD_TYPES.map((c) => c.value));

export function toQuery({ view, category, recipeId, q }: DashboardUrlState): string {
  const params = new URLSearchParams();
  if (view === "add") {
    // Nothing else is meaningful while the form is open, and carrying a search
    // term into it would put it back in the address bar on cancel.
    params.set("mode", "new");
    return params.toString();
  }
  if (q.trim() && view === "list") params.set("q", q.trim());
  if (category) params.set("category", category);
  if ((view === "detail" || view === "edit") && recipeId) params.set("recipe", recipeId);
  if (view === "edit" && recipeId) params.set("mode", "edit");
  return params.toString();
}

export function fromQuery(params: URLSearchParams): DashboardUrlState {
  const mode = params.get("mode");
  const rawCategory = params.get("category");
  // Anything not in the vocabulary is ignored rather than trusted — a
  // hand-edited URL should degrade to the whole list, not render an empty one.
  const category = rawCategory && VALID_CATEGORIES.has(rawCategory) ? (rawCategory as FoodType) : null;
  const recipeId = params.get("recipe");

  if (mode === "new") return { view: "add", category, recipeId: null, q: "" };
  if (recipeId) {
    // A search term is dropped on the way into a recipe: it narrowed the list,
    // and re-applying it on the way back out is handled by the history entry,
    // not by carrying it through the detail view's URL.
    return { view: mode === "edit" ? "edit" : "detail", category, recipeId, q: "" };
  }
  return { view: "list", category, recipeId: null, q: params.get("q") ?? "" };
}
