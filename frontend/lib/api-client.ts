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
  food_type: "bebida" | "postre" | "comida" | "aperitivo";
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
/** `list_closed` is what the UI calls *archived* — see §8.2 for why it isn't a fourth state. */
export type PlanStatus = "planning" | "calendar_closed" | "list_closed";

/** Why a line is on the list. `dish_name` is a snapshot, so it survives the recipe being deleted. */
export interface ListItemSource {
  entry_id: string | null;
  dish_name: string;
  amount: number | null;
}

export interface ShoppingListItem {
  id: string;
  display_name: string;
  normalised_name: string;
  unit: string | null;
  /** `null` for things with no quantity — "sal" is a real ingredient, not a zero. */
  total_amount: number | null;
  is_checked: boolean;
  is_manual: boolean;
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
  /** Only restaurants the signed-in user has reviewed. Resolved server-side from the JWT. */
  mine?: boolean;
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
  food_type: "bebida" | "postre" | "comida" | "aperitivo";
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

  async removeItem(planId: string, itemId: string): Promise<void> {
    await this.request<void>(`/plans/${planId}/items/${itemId}`, { method: "DELETE" });
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

  /** Takes the one transition available. `fromStatus` is what the client believes it is leaving — a mismatch is a 409, so a double tap can't close both the calendar and the list. */

  async advancePlan(planId: string, fromStatus: "planning" | "calendar_closed", carryOver: string[] = []): Promise<MealPlan> {
    return this.request<MealPlan>(`/plans/${planId}/status`, {
      method: "POST",
      // `carry_over` names the unticked lines to copy onto next week. It travels
      // with the transition rather than as a second call because the lines have
      // to be read while the plan is still open — once it is list_closed every
      // write is refused, and a half-done carry-over would lose them.
      body: JSON.stringify({ from_status: fromStatus, carry_over: carryOver }),
    });
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
    if (query.mine) params.set("mine", "true");
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
