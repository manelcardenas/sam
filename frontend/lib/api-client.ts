import type { FoodType } from "@/lib/constants";

import { fetchAuthSession } from "aws-amplify/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export interface IngredientsData {
  servings: number | null;
  items: { name: string; amount?: number; unit?: string }[];
}

export interface IngredientsInput {
  servings: number;
  items: { name: string; amount?: number; unit?: string }[];
}

export interface Recipe {
  id: string;
  title: string;
  /** Optional: a recipe you already know how to make is still plannable and shoppable. */
  instructions: string | null;
  ingredients: IngredientsData;
  food_type: FoodType;
  source_url: string | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}


// ── Meal planner (docs/plans/meal-planner-plan.md) ───────────────────────────

export type Meal = "lunch" | "dinner";
/**
 * `list_closed` is a week archived under the old "done shopping" flow — read-only,
 * and nothing can produce one any more (meal-planner-plan §8.14). Every new week
 * is `planning` for its whole life.
 */
export type PlanStatus = "planning" | "list_closed";

/** Why a line is on the list. `dish_name` is a snapshot, so it survives the recipe being deleted. */
export interface ListItemSource {
  entry_id: string | null;
  dish_name: string;
  amount: number | null;
}

export type Aisle =
  | "produce"
  | "bakery"
  | "meat_fish"
  | "dairy_eggs"
  | "frozen"
  | "canned"
  | "dry_goods"
  | "condiments"
  | "drinks"
  | "household"
  | "other";

/**
 * One buyable thing in the shared vocabulary
 * (docs/plans/ingredient-capture-plan.md §3).
 *
 * Three names rather than one is about **merging**, not translation: without
 * them `huevos` and `eggs` are two lines on one shopping list, and this is the
 * only place that can know they are the same thing.
 *
 * It carries no quantity. How much belongs to a recipe; this says what shelf.
 */
export interface GroceryItem {
  key: string;
  name_es: string;
  name_ca: string;
  name_en: string;
  aisle: Aisle;
  /** Normally already at home. Starts its line unticked — never hides it. */
  is_pantry: boolean;
  default_unit: string | null;
  /** Who decided this row was a thing. Optional here only so fixtures can omit it; the API always sends it. */
  source?: GrocerySource;
  /** When a person last vouched for it. `null` = nobody has — the admin panel's "to review". */
  confirmed_at?: string | null;
  created_at?: string;
}

export type GrocerySource = "seed" | "ai" | "human";

/** Enough of a recipe to name it and link to it. */
export interface RecipeRef {
  id: string;
  title: string;
}

/** Everything an admin can change about a vocabulary row — all of it but the key. */
export interface GroceryItemInput {
  name_es: string;
  name_ca: string;
  name_en: string;
  aisle: Aisle;
  is_pantry: boolean;
  default_unit: string | null;
}

/** One ingredient line as the parser understood it (plan §4.3). */
export interface ParsedIngredientLine {
  /** The user's own words for this line — how you tell a misread from a mistype. */
  raw: string;
  item: GroceryItem;
  amount: number | null;
  unit: string | null;
  /** This call created the vocabulary row. Doubles as the typo detector. */
  is_new: boolean;
  /** Existing names it might be a misspelling of. A question, never a decision. */
  did_you_mean: string[];
}

export interface ParsedIngredients {
  lines: ParsedIngredientLine[];
}

export interface ShoppingListItem {
  id: string;
  display_name: string;
  normalised_name: string;
  /**
   * The `grocery_items` row this line means, resolved server-side on write.
   * `null` for anything the vocabulary does not know — the line still works,
   * it just has no aisle and merges on its own name.
   */
  grocery_key: string | null;
  unit: string | null;
  /** `null` for things with no quantity — "sal" is a real ingredient, not a zero. */
  total_amount: number | null;
  is_checked: boolean;
  is_manual: boolean;
  /**
   * The Saturday of the week this line was first meant for, when it was not
   * bought there and followed you here. `null` for a line that belongs to this
   * week. A date, not a flag, so the list can say how long it has been waiting.
   */
  pending_since: string | null;
  sources: ListItemSource[];
  /**
   * Who put the line on the list. Attribution, not permission — anyone in the
   * kitchen can tick or remove any line. A line two people contributed to keeps
   * the first name: the question is who added it, and that happened once.
   */
  created_by: string | null;
  created_by_name: string | null;
}

export interface PlanEntry {
  id: string;
  date: string; // YYYY-MM-DD
  meal: Meal;
  recipe_id: string | null; // null once the recipe is deleted; dish_name survives
  dish_name: string;
  servings: number;
  /** Whoever last set this slot — attribution only; anyone in the kitchen can change it. */
  created_by: string | null;
  created_by_name: string | null;
}

/**
 * Someone in a kitchen, or someone invited to one
 * (docs/plans/meal-planner-plan.md §8.12).
 *
 * `joined_at` is null while an invitation is outstanding. That is the only
 * difference between a member and an invite — there is no status field, because
 * "invited" is exactly "a membership nobody has accepted yet".
 */
export interface KitchenMember {
  user_id: string;
  display_name: string | null;
  joined_at: string | null;
  invited_by: string | null;
}

/**
 * A household's shared planner. No owner, no roles: if you are in it, the week
 * and its list are yours. A kitchen of one is the ordinary case.
 */
export interface Kitchen {
  id: string;
  members: KitchenMember[];
  /** Invitations this kitchen has sent that nobody has answered yet. */
  pending: KitchenMember[];
  created_at: string;
}

/** An invitation addressed to you, showing whose kitchen it is — accepting is a move. */
export interface KitchenInvite {
  kitchen_id: string;
  invited_by: string;
  invited_by_name: string | null;
  members: KitchenMember[];
}

export interface KitchenView {
  kitchen: Kitchen;
  invitations: KitchenInvite[];
}

/**
 * Somebody you could ask into your kitchen: a name and an id, nothing else.
 *
 * Not a `User` — the invite picker is the one place this app shows somebody
 * else's account, and an email has no business travelling with it.
 */
export interface Person {
  id: string;
  display_name: string;
}

export interface MealPlan {
  id: string;
  /** The household this week belongs to, not a person — see §8.12. */
  kitchen_id: string;
  week_start: string; // YYYY-MM-DD, always a Saturday — weeks run Sat→Fri
  status: PlanStatus;
  entries: PlanEntry[];
  items: ShoppingListItem[];
  /** Who started the week. Informational — membership is what gates writes. */
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One week in the archive. Deliberately *not* a MealPlan: a year holds up to 53
 * of them, and the year view shows which weeks were planned and how full they
 * were — not what was in them.
 */
export interface PlanSummary {
  id: string;
  week_start: string;
  status: PlanStatus;
  entry_count: number;
  item_count: number;
  checked_count: number;
}

export interface AssignDishInput {
  date: string;
  meal: Meal;
  recipe_id: string | null;
  dish_name: string;
  servings: number;
}

export interface ListLineInput {
  name: string;
  amount?: number | null;
  unit?: string | null;
}

export interface UserProfile {
  id: string;
  display_name: string | null; // null until the user chooses one
  email: string;
  created_at: string;
  updated_at: string;
  /**
   * In the Cognito `admins` group, per the token that fetched this. Decides
   * what the UI *shows* — the admin routes check the token themselves. Optional
   * because a profile cached before this field existed has no value for it.
   */
  is_admin?: boolean;
}

export interface Cuisine {
  id: string;
  name: string;
}

export interface Restaurant {
  id: string;
  name: string;
  address: string | null;
  price_level: 1 | 2 | 3 | 4 | null; // € … €€€€ — a fact about the venue, not a review score
  latitude: number | null; // copied from the picked Place when Mapped; null for Unmapped restaurants
  longitude: number | null;
  external_place_id: string | null; // Geoapify place id when Mapped; null for Unmapped (manual) restaurants
  cuisines: string[];
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface RestaurantDetail extends Restaurant {
  review_count: number;
  average_location: number | null;
  average_food: number | null;
  average_service: number | null;
  average_value: number | null;
  average_overall: number | null;

  // ── Scrapbook fields (docs/adr/0005) — the human trace of a visit ──
  last_visited_at: string | null; // "YYYY-MM-DD"; also the list's default sort key
  reviewer_names: string[]; // distinct reviewers, alphabetical
  /** The same people with their ids, same order — what "Reviewed by" is built from. */
  reviewers: Person[];
  /** Newest review that actually has a comment — not necessarily the newest review. */
  last_comment: string | null;
  last_comment_by: string | null;
  last_comment_at: string | null; // the quoted visit's date, which can predate last_visited_at
}

/**
 * Mirrors backend `RestaurantSort`. "name" is used by the create-form dedup
 * lookup, not the UI.
 *
 * Four named orderings rather than two keys plus a direction flag: direction is
 * a decision per ordering, not a modifier, because unrated and unvisited
 * restaurants must sort last in *both* directions (no score is not a bad score).
 * See docs/plans/ux-refresh-plan.md §5.
 */
export type RestaurantSort = "recent" | "oldest" | "name" | "rating" | "rating_low";

/** How the dine list narrows itself. Everything is optional; the default is the whole archive, most recent first. */
export interface RestaurantQuery {
  q?: string;
  cuisines?: string[];
  priceLevels?: number[];
  minScore?: number | null;
  /** User ids, OR-ed together: only restaurants one of them has reviewed. Empty means anyone. */
  reviewers?: string[];
  sort?: RestaurantSort;
}

/** A review shown outside its restaurant's page, so it carries the restaurant's name. */
export interface UserReview extends Review {
  restaurant_name: string;
}

export interface UserStats {
  reviews_written: number;
  places_reviewed: number;
  average_score_given: number | null;
  top_cuisine: string | null;
}

export interface Review {
  id: string;
  restaurant_id: string;
  user_id: string;
  reviewer_name: string | null;
  location_score: number; // 0-10, step 0.5 — location/decoration
  food_score: number;
  service_score: number;
  value_score: number; // value for money, NOT price_level
  comment: string | null;
  visited_at: string; // "YYYY-MM-DD"
  overall: number; // average of the 4 category scores — computed server-side, never entered directly
  created_at: string;
  updated_at: string;
}

export interface CreateRestaurantInput {
  name: string;
  address?: string;
  price_level?: 1 | 2 | 3 | 4;
  cuisines: string[];
  /** Set when the user picked a Place — the restaurant is created Mapped. */
  external_place_id?: string;
  latitude?: number;
  longitude?: number;
}

/** A city/neighbourhood/address anchoring a Place search somewhere else — ephemeral, never stored. */
export interface Area {
  name: string; // short name, e.g. "Zaragoza"
  label: string; // disambiguated, e.g. "Zaragoza, Aragon, Spain"
  latitude: number;
  longitude: number;
}

/** The map provider's record of a venue — never stored by SAM; picking one creates a Mapped restaurant. */
export interface Place {
  external_place_id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  cuisines: string[]; // raw provider tags, lowercase — match against the curated Cuisine list
  distance_m: number | null;
}

export interface CreateRestaurantResult {
  restaurant: Restaurant;
  /** True when the picked Place was already on SAM and the existing restaurant was returned (HTTP 200, not 201). */
  alreadyExisted: boolean;
}

export interface CreateReviewInput {
  location_score: number;
  food_score: number;
  service_score: number;
  value_score: number;
  comment?: string;
  visited_at: string; // "YYYY-MM-DD"
}

/** Error carrying the HTTP status, so callers can branch on e.g. 409. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface CreateRecipeInput {
  title: string;
  /** Omit or send empty to create a dish rather than a recipe — docs/adr/0007. */
  instructions: string | null;
  ingredients: IngredientsInput;
  food_type: FoodType;
  source_url?: string;
  prep_time_minutes?: number | null;
  cook_time_minutes?: number | null;
}

async function getAuthToken(): Promise<string> {
  try {
    const session = await fetchAuthSession();
    // ID token carries the `email` claim — needed by the backend to JIT-provision the user row in `users`.
    const token = session.tokens?.idToken?.toString();
    if (!token) {
      throw new Error("No authentication token available");
    }
    return token;
  } catch (error) {
    console.error("Error getting auth token:", error);
    throw error;
  }
}

export class RecipeAPIClient {
  private baseUrl: string;

  constructor() {
    if (!API_URL) {
      throw new Error("NEXT_PUBLIC_API_URL environment variable is not set");
    }
    this.baseUrl = API_URL;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const { data } = await this.requestWithStatus<T>(endpoint, options);
    return data;
  }

  /** Like request(), but also exposes the HTTP status — needed where the backend signals via 200-vs-201 (idempotent restaurant create). */
  private async requestWithStatus<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<{ data: T; status: number }> {
    const token = await getAuthToken();

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ApiError(
        response.status,
        `API Error (${response.status}): ${errorText || response.statusText}`,
      );
    }

    // Handle 204 No Content (empty body)
    if (response.status === 204) {
      return { data: undefined as T, status: response.status };
    }

    return { data: await response.json(), status: response.status };
  }

  /** Every recipe. One collection — anything with ingredients is plannable. */
  async listRecipes(): Promise<Recipe[]> {
    return this.request<Recipe[]>("/recipes");
  }

  async getRecipe(id: string): Promise<Recipe> {
    return this.request<Recipe>(`/recipes/${id}`);
  }

  async createRecipe(data: CreateRecipeInput): Promise<Recipe> {
    return this.request<Recipe>("/recipes", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateRecipe(id: string, data: CreateRecipeInput): Promise<Recipe> {
    return this.request<Recipe>(`/recipes/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }


  // ── Meal planner ───────────────────────────────────────────────────────────
  //
  // Every mutation returns the whole plan rather than the thing it changed: one
  // write can move several parts (removing a dish can delete list lines, adding
  // one can merge into an existing line), so patching a local copy from a
  // partial response would drift.

  /** The week containing `day`, or `null` — most weeks have no plan, which is not an error. */
  async getPlan(day: string): Promise<MealPlan | null> {
    return this.request<MealPlan | null>(`/plans?day=${encodeURIComponent(day)}`);
  }

  /**
   * The week containing `day`, after moving onto it whatever earlier weeks left
   * unbought (§8.14). Called instead of `getPlan` when the planner opens the
   * current week; idempotent, and `null` when there is neither a week nor
   * anything to carry into one.
   */
  async carryForward(day: string): Promise<MealPlan | null> {
    return this.request<MealPlan | null>("/plans/carry-forward", { method: "POST", body: JSON.stringify({ day }) });
  }

  /**
   * One exact week, by id — how the archive links to a week.
   *
   * The same route as `getPlan`, with the other parameter. A `/plans/{id}` path
   * would sit next to the literal `/plans/archive` on an API Gateway that
   * matches exactly, which the CDK stack names as a hazard; so the choice is a
   * query parameter instead, and the server refuses both or neither.
   *
   * It reads wider than `getPlan` does: a kitchen you have left still owes you
   * its archive, so this resolves against every kitchen you have been in.
   */
  async getPlanById(planId: string): Promise<MealPlan> {
    return this.request<MealPlan>(`/plans?plan_id=${encodeURIComponent(planId)}`);
  }

  async assignDish(data: AssignDishInput): Promise<MealPlan> {
    return this.request<MealPlan>("/plans/entries", { method: "PUT", body: JSON.stringify(data) });
  }

  /**
   * Clear a slot. `dropFromList` defaults to false: the list never rewrites
   * itself while you are holding it in the shop, so the caller asks first
   * (docs/plans/meal-planner-plan.md §4.5).
   */
  async removeEntry(planId: string, entryId: string, dropFromList = false): Promise<MealPlan> {
    return this.request<MealPlan>(`/plans/${planId}/entries/${entryId}?drop_from_list=${dropFromList}`, { method: "DELETE" });
  }

  /** `entryId` null means a hand-added extra — fruit, yoghurt, the things no dish implies. */
  /**
   * Put hand-typed lines on a week's list, whether or not that week has been
   * planned. Keyed by a day rather than a plan id precisely because there may
   * not be a plan yet — this is the path that lets you add sugar to next week
   * in the middle of this one.
   */
  async addToWeekList(day: string, items: ListLineInput[]): Promise<MealPlan> {
    return this.request<MealPlan>("/plans/items", {
      method: "POST",
      body: JSON.stringify({ day, items }),
    });
  }

  /**
   * Replace one dish's contribution to the list after its headcount changed.
   *
   * A PUT, not another POST to `/items`: this is idempotent and total for the
   * dish, where adding is additive. Calling it twice leaves the same list.
   */
  async resyncEntryList(planId: string, entryId: string, dishName: string, items: ListLineInput[]): Promise<MealPlan> {
    return this.request<MealPlan>(`/plans/${planId}/entries/${entryId}/items`, {
      method: "PUT",
      body: JSON.stringify({ dish_name: dishName, items }),
    });
  }

  async addToList(planId: string, items: ListLineInput[], entryId: string | null = null, dishName: string | null = null): Promise<MealPlan> {
    return this.request<MealPlan>(`/plans/${planId}/items`, {
      method: "POST",
      body: JSON.stringify({ entry_id: entryId, dish_name: dishName, items }),
    });
  }

  async tickItem(planId: string, itemId: string, isChecked: boolean): Promise<ShoppingListItem> {
    return this.request<ShoppingListItem>(`/plans/${planId}/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ is_checked: isChecked }),
    });
  }

  /** A new total for a line, in its own unit. Same route as ticking; only what is sent changes. */
  async setItemAmount(planId: string, itemId: string, amount: number): Promise<ShoppingListItem> {
    return this.request<ShoppingListItem>(`/plans/${planId}/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ amount }),
    });
  }

  async removeItem(planId: string, itemId: string): Promise<void> {
    await this.request<void>(`/plans/${planId}/items/${itemId}`, { method: "DELETE" });
  }

  /**
   * File a list line in the aisle somebody picked.
   *
   * One call whether or not the vocabulary knows the line: a known line moves
   * its vocabulary row (for everybody), an unknown one becomes a row filed where
   * you said — so typing the same thing next week lands there on its own.
   */
  async fileListItem(planId: string, itemId: string, aisle: Aisle): Promise<MealPlan> {
    return this.request<MealPlan>(`/plans/${planId}/items/${itemId}/aisle`, {
      method: "PUT",
      body: JSON.stringify({ aisle }),
    });
  }

  /**
   * Ask the model which aisle a hand-typed line belongs in.
   *
   * **Only ever after the line is on the list** — adding never waits for this.
   * Throws `ApiError` 503 when no provider answers; the caller's answer is to do
   * nothing, because the line is already safely in Other.
   */
  async classifyListItem(planId: string, itemId: string): Promise<MealPlan> {
    return this.request<MealPlan>(`/plans/${planId}/items/${itemId}/classify`, { method: "POST" });
  }

  /** Weeks planned in a year, newest first — across every kitchen you have been in. */
  async getPlanArchive(year: number): Promise<PlanSummary[]> {
    return this.request<PlanSummary[]>(`/plans/archive?year=${year}`);
  }

  // ── The kitchen (docs/plans/meal-planner-plan.md §8.12) ────────────────────

  /** Who you share a planner with, plus any invitations addressed to you. Creates your kitchen on first call. */
  async getKitchen(): Promise<KitchenView> {
    return this.request<KitchenView>("/kitchen");
  }


  /**
   * Who the invite picker offers: everybody not already here and not already
   * asked. Filtered by the server, because "invitable" is a fact about the
   * kitchen and keeping a copy of the rule here would give it two places to be
   * wrong.
   */
  /**
   * The whole grocery vocabulary, in one call.
   *
   * Deliberately unfiltered and unpaginated — a few hundred rows the client
   * holds for the session, serving both the shopping list's aisle grouping and
   * the manual-add autocomplete. Filtering server-side would put the network in
   * front of every keystroke.
   */
  async listGroceryItems(): Promise<GroceryItem[]> {
    return this.request<GroceryItem[]>("/grocery-items");
  }

  /**
   * Admins only: which recipes use each vocabulary row, by key, alphabetical.
   * A key no recipe uses is absent. Resolved from recipe ingredient names the
   * same way the shopping list resolves them.
   */
  async getGroceryUsage(): Promise<Record<string, RecipeRef[]>> {
    return this.request<Record<string, RecipeRef[]>>("/admin/grocery-items/usage");
  }

  /** Admins only: rewrite a vocabulary row. 409 when a name already belongs to another row. */
  async updateGroceryItem(key: string, input: GroceryItemInput): Promise<GroceryItem> {
    return this.request<GroceryItem>(`/admin/grocery-items/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  /** Admins only: delete a vocabulary row. 409 for seeded rows, which the next deploy would recreate. */
  async deleteGroceryItem(key: string): Promise<void> {
    await this.request<void>(`/admin/grocery-items/${encodeURIComponent(key)}`, { method: "DELETE" });
  }

  /** Move one vocabulary row to another aisle — a correction to the shared vocabulary, for everybody. */
  async setGroceryAisle(key: string, aisle: Aisle): Promise<GroceryItem> {
    return this.request<GroceryItem>(`/grocery-items/${encodeURIComponent(key)}/aisle`, {
      method: "PUT",
      body: JSON.stringify({ aisle }),
    });
  }

  /**
   * Structure a block of free-typed ingredients.
   *
   * Throws `ApiError` with status 503 when every provider is unreachable — the
   * caller's answer to that is the manual fallback, not a retry.
   */
  async parseIngredients(text: string, servings: number): Promise<ParsedIngredients> {
    return this.request<ParsedIngredients>("/ingredients/parse", {
      method: "POST",
      body: JSON.stringify({ text, servings }),
    });
  }

  async listInvitablePeople(): Promise<Person[]> {
    return this.request<Person[]>("/kitchen/people");
  }

  /**
   * Invite someone you picked from that list. An invitation rather than an
   * addition: joining means leaving their own kitchen.
   *
   * By id, not by name. Typing a name exactly was the old form, and a
   * misremembered spelling came back as "nobody here is called that" — an error
   * for a question the app could already answer.
   */
  async inviteToKitchen(userId: string): Promise<Kitchen> {
    return this.request<Kitchen>("/kitchen/members", {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    });
  }

  /** Accept or decline. Accepting leaves the kitchen you are in, in the same step. */
  async answerInvitation(kitchenId: string, accept: boolean): Promise<KitchenView> {
    return this.request<KitchenView>(`/kitchen/invitations/${encodeURIComponent(kitchenId)}`, {
      method: "PATCH",
      body: JSON.stringify({ accept }),
    });
  }

  /**
   * Leave (pass your own id) or withdraw an invitation you sent (pass theirs).
   * The only two permitted targets — nobody can remove anybody else.
   */
  async removeFromKitchen(userId: string): Promise<Kitchen> {
    return this.request<Kitchen>(`/kitchen/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
  }

  async deleteRecipe(id: string): Promise<void> {
    await this.request<void>(`/recipes/${id}`, {
      method: "DELETE",
    });
  }

  async searchRestaurants(query: RestaurantQuery = {}): Promise<RestaurantDetail[]> {
    const params = new URLSearchParams();
    if (query.q?.trim()) params.set("q", query.q.trim());
    // Repeated keys, not comma-joined: FastAPI reads list[str] query params that way.
    query.cuisines?.forEach((c) => params.append("cuisines", c));
    query.priceLevels?.forEach((p) => params.append("price_levels", String(p)));
    if (query.minScore != null) params.set("min_score", String(query.minScore));
    query.reviewers?.forEach((id) => params.append("reviewers", id));
    if (query.sort) params.set("sort", query.sort);
    const qs = params.toString();
    return this.request<RestaurantDetail[]>(`/restaurants${qs ? `?${qs}` : ""}`);
  }

  async getRestaurant(id: string): Promise<RestaurantDetail> {
    return this.request<RestaurantDetail>(`/restaurants/${id}`);
  }

  async createRestaurant(data: CreateRestaurantInput): Promise<CreateRestaurantResult> {
    const { data: restaurant, status } = await this.requestWithStatus<Restaurant>("/restaurants", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return { restaurant, alreadyExisted: status === 200 };
  }

  async searchPlaces(query: string, coords?: { lat: number; lon: number }): Promise<Place[]> {
    const params = new URLSearchParams({ q: query.trim() });
    if (coords) {
      params.set("lat", String(coords.lat));
      params.set("lon", String(coords.lon));
    }
    return this.request<Place[]>(`/places/search?${params}`);
  }

  async searchAreas(query: string): Promise<Area[]> {
    return this.request<Area[]>(`/places/areas?q=${encodeURIComponent(query.trim())}`);
  }

  /** Address at a pin-dropped point — used to prefill the address field, never stored. */
  async reverseGeocode(coords: { lat: number; lon: number }): Promise<{ address: string | null }> {
    const params = new URLSearchParams({ lat: String(coords.lat), lon: String(coords.lon) });
    return this.request<{ address: string | null }>(`/places/reverse?${params}`);
  }

  async nearbyPlaces(coords: { lat: number; lon: number }, radiusM = 500): Promise<Place[]> {
    const params = new URLSearchParams({
      lat: String(coords.lat),
      lon: String(coords.lon),
      radius_m: String(radiusM),
    });
    return this.request<Place[]>(`/places/nearby?${params}`);
  }

  async updateRestaurant(id: string, data: CreateRestaurantInput): Promise<Restaurant> {
    return this.request<Restaurant>(`/restaurants/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async listCuisines(): Promise<Cuisine[]> {
    return this.request<Cuisine[]>("/cuisines");
  }

  async listReviews(restaurantId: string): Promise<Review[]> {
    return this.request<Review[]>(`/restaurants/${restaurantId}/reviews`);
  }

  async createReview(restaurantId: string, data: CreateReviewInput): Promise<Review> {
    return this.request<Review>(`/restaurants/${restaurantId}/reviews`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** Author-only (backend enforces 403 otherwise). */
  async updateReview(restaurantId: string, reviewId: string, data: CreateReviewInput): Promise<Review> {
    return this.request<Review>(`/restaurants/${restaurantId}/reviews/${reviewId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteReview(restaurantId: string, reviewId: string): Promise<void> {
    await this.request<void>(`/restaurants/${restaurantId}/reviews/${reviewId}`, {
      method: "DELETE",
    });
  }

  async listMyReviews(): Promise<UserReview[]> {
    return this.request<UserReview[]>("/users/me/reviews");
  }

  async getMyStats(): Promise<UserStats> {
    return this.request<UserStats>("/users/me/stats");
  }

  /** Only the caller's recipes, scoped server-side from the JWT — /profile used
   *  to fetch every recipe and filter in the browser. */
  async listMyRecipes(): Promise<Recipe[]> {
    return this.request<Recipe[]>("/recipes?mine=true");
  }

  async getMe(): Promise<UserProfile> {
    return this.request<UserProfile>("/users/me");
  }

  async updateDisplayName(displayName: string): Promise<UserProfile> {
    return this.request<UserProfile>("/users/me", {
      method: "PATCH",
      body: JSON.stringify({ display_name: displayName }),
    });
  }

  async healthCheck(): Promise<{ status: string; service: string }> {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) {
      throw new Error("Health check failed");
    }
    return response.json();
  }
}

export const apiClient = new RecipeAPIClient();
