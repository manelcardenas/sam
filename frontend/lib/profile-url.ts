import { FOOD_TYPES, type FoodType } from "@/lib/constants";

/**
 * The /profile view state machine, as a query string.
 *
 * overview  →  /profile
 * recipes   →  /profile?tab=recipes            (+ &q=, &category=)
 * reviews   →  /profile?tab=reviews            (+ &q=, &sort=score)
 * account   →  /profile?tab=account
 *
 * Same shape and the same reasoning as `dine-url.ts` / `dashboard-url.ts`:
 * `output: 'export'` rules out path segments, so views live in query params
 * (routing-and-latency-plan.md §3). The prize is the device back gesture —
 * moving between profile sections now goes back a section instead of leaving
 * the app.
 *
 * **Narrowing state is scoped to the tab that owns it.** `category` only means
 * something on the recipes tab and `sort` only on the reviews tab, so both are
 * dropped when reading any other tab. Without that, searching your recipes and
 * then switching to reviews would carry the recipe search across and show you
 * an empty list with no visible cause.
 */

export const PROFILE_TABS = ["overview", "recipes", "reviews", "account"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

/** How the reviews list is ordered. `recent` is the default and stays out of the URL. */
export const REVIEW_SORTS = ["recent", "score"] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];

export interface ProfileUrlState {
  tab: ProfileTab;
  /** Free-text narrowing. Meaningful on the recipes and reviews tabs only. */
  q: string;
  /** Recipes tab only. */
  category: FoodType | null;
  /** Reviews tab only. */
  sort: ReviewSort;
}

export const INITIAL_STATE: ProfileUrlState = {
  tab: "overview",
  q: "",
  category: null,
  sort: "recent",
};

const VALID_TABS = new Set<string>(PROFILE_TABS);
const VALID_CATEGORIES = new Set<string>(FOOD_TYPES.map((c) => c.value));
const VALID_SORTS = new Set<string>(REVIEW_SORTS);

/** Which tabs a given param is allowed to appear on. */
const NARROWABLE: ReadonlySet<ProfileTab> = new Set<ProfileTab>(["recipes", "reviews"]);

export function toQuery({ tab, q, category, sort }: ProfileUrlState): string {
  const params = new URLSearchParams();
  // The hub is the bare URL, so /profile is always a valid, canonical link.
  if (tab !== "overview") params.set("tab", tab);
  if (NARROWABLE.has(tab) && q.trim()) params.set("q", q.trim());
  if (tab === "recipes" && category) params.set("category", category);
  if (tab === "reviews" && sort !== "recent") params.set("sort", sort);
  return params.toString();
}

export function fromQuery(params: URLSearchParams): ProfileUrlState {
  // Anything outside the vocabulary degrades to the hub rather than rendering a
  // tab that doesn't exist — the same guard dashboard-url applies to ?category.
  const rawTab = params.get("tab");
  const tab: ProfileTab = rawTab && VALID_TABS.has(rawTab) ? (rawTab as ProfileTab) : "overview";

  const rawCategory = params.get("category");
  const rawSort = params.get("sort");

  return {
    tab,
    q: NARROWABLE.has(tab) ? (params.get("q") ?? "") : "",
    category:
      tab === "recipes" && rawCategory && VALID_CATEGORIES.has(rawCategory)
        ? (rawCategory as FoodType)
        : null,
    sort: tab === "reviews" && rawSort && VALID_SORTS.has(rawSort) ? (rawSort as ReviewSort) : "recent",
  };
}

/**
 * Switching tab drops the previous tab's narrowing.
 *
 * Deliberately takes only the destination: carrying `q` across would show an
 * unexplained empty list, and there is no case where the recipes search should
 * survive into the reviews tab. Kept here rather than in the page so the rule
 * is covered by the tests below the round trip.
 */
export function withTab(tab: ProfileTab): ProfileUrlState {
  return { ...INITIAL_STATE, tab };
}
