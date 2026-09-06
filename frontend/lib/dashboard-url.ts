import { FOOD_TYPES, type FoodType } from "@/lib/constants";

/**
 * The /dashboard view state machine, as a query string.
 *
 * categories                    →  /dashboard
 * recipes    (a category open)  →  /dashboard?category=comida
 * detail     (a recipe open)    →  /dashboard?category=comida&recipe=<id>
 * edit                          →  /dashboard?category=comida&recipe=<id>&mode=edit
 * add                           →  /dashboard?mode=new
 *
 * `category` is kept alongside `recipe` so that backing out of a recipe lands
 * on the list you came from rather than the top-level grid.
 */

export type DashboardView = "categories" | "recipes" | "detail" | "add" | "edit";

export interface DashboardUrlState {
  view: DashboardView;
  category: FoodType | null;
  recipeId: string | null;
}

const VALID_CATEGORIES = new Set<string>(FOOD_TYPES.map((c) => c.value));

export function toQuery({ view, category, recipeId }: DashboardUrlState): string {
  const params = new URLSearchParams();
  if (view === "add") {
    params.set("mode", "new");
    return params.toString();
  }
  if (category) params.set("category", category);
  if ((view === "detail" || view === "edit") && recipeId) params.set("recipe", recipeId);
  if (view === "edit" && recipeId) params.set("mode", "edit");
  return params.toString();
}

export function fromQuery(params: URLSearchParams): DashboardUrlState {
  const mode = params.get("mode");
  const rawCategory = params.get("category");
  // Anything not in the vocabulary is ignored rather than trusted — a
  // hand-edited URL should degrade to the grid, not render an empty category.
  const category = rawCategory && VALID_CATEGORIES.has(rawCategory) ? (rawCategory as FoodType) : null;
  const recipeId = params.get("recipe");

  if (mode === "new") return { view: "add", category, recipeId: null };
  if (recipeId) return { view: mode === "edit" ? "edit" : "detail", category, recipeId };
  if (category) return { view: "recipes", category, recipeId: null };
  return { view: "categories", category: null, recipeId: null };
}
