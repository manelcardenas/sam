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
  instructions: string;
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

export type RestaurantSort = "recent" | "name";

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
  instructions: string;
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
