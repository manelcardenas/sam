import { fetchAuthSession } from 'aws-amplify/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export interface Recipe {
  id: string;
  title: string;
  description: string;
  ingredients: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateRecipeInput {
  title: string;
  description: string;
  ingredients: string[];
}

async function getAuthToken(): Promise<string> {
  try {
    const session = await fetchAuthSession();
    // Use access token instead of ID token (ID token has at_hash claim that requires access token for validation)
    const token = session.tokens?.accessToken?.toString();
    if (!token) {
      throw new Error('No authentication token available');
    }
    return token;
  } catch (error) {
    console.error('Error getting auth token:', error);
    throw error;
  }
}

export class RecipeAPIClient {
  private baseUrl: string;

  constructor() {
    if (!API_URL) {
      throw new Error('NEXT_PUBLIC_API_URL environment variable is not set');
    }
    this.baseUrl = API_URL;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = await getAuthToken();

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `API Error (${response.status}): ${errorText || response.statusText}`
      );
    }

    return response.json();
  }

  async listRecipes(): Promise<Recipe[]> {
    return this.request<Recipe[]>('/recipes');
  }

  async getRecipe(id: string): Promise<Recipe> {
    return this.request<Recipe>(`/recipes/${id}`);
  }

  async createRecipe(data: CreateRecipeInput): Promise<Recipe> {
    return this.request<Recipe>('/recipes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateRecipe(
    id: string,
    data: CreateRecipeInput
  ): Promise<Recipe> {
    return this.request<Recipe>(`/recipes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteRecipe(id: string): Promise<void> {
    await this.request<void>(`/recipes/${id}`, {
      method: 'DELETE',
    });
  }

  async healthCheck(): Promise<{ status: string; service: string }> {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) {
      throw new Error('Health check failed');
    }
    return response.json();
  }
}

export const apiClient = new RecipeAPIClient();
