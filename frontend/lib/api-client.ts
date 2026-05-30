import { fetchAuthSession } from "aws-amplify/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export interface IngredientsData {
  servings: number | null;
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
  ingredients: IngredientsData;
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
      return undefined as T;
    }

    return response.json();
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
