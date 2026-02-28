"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser, signOut, fetchUserAttributes } from "aws-amplify/auth";
import { configureAmplify } from "@/lib/amplify";
import {
  apiClient,
  type Recipe,
  type CreateRecipeInput,
} from "@/lib/api-client";
import {
  LogOut,
  Plus,
  Edit,
  Trash2,
  ChefHat,
  X,
  Save,
  List,
} from "lucide-react";

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState("");
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [error, setError] = useState("");
  const [activeView, setActiveView] = useState<"list" | "add" | "edit">("list");
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [formData, setFormData] = useState<CreateRecipeInput>({
    title: "",
    description: "",
    ingredients: [],
  });
  const [ingredientsText, setIngredientsText] = useState("");

  useEffect(() => {
    configureAmplify();
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkAuth = async () => {
    try {
      await getCurrentUser();
      const attributes = await fetchUserAttributes();
      setUserEmail(attributes.email || "User");
      await loadRecipes();
    } catch (err) {
      console.error("Not authenticated:", err);
      router.push("/");
    } finally {
      setLoading(false);
    }
  };

  const loadRecipes = async () => {
    try {
      setError("");
      const data = await apiClient.listRecipes();
      setRecipes(data);
    } catch (err) {
      console.error("Error loading recipes:", err);
      setError(err instanceof Error ? err.message : "Failed to load recipes");
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut({ global: true });
      router.push("/");
    } catch (err) {
      console.error("Sign out error:", err);
      // Force sign out even if there's an error
      router.push("/");
    }
  };

  const handleAddRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      const ingredients = ingredientsText
        .split("\n")
        .map((i) => i.trim())
        .filter((i) => i.length > 0);

      await apiClient.createRecipe({
        ...formData,
        ingredients,
      });

      await loadRecipes();
      setActiveView("list");
      resetForm();
    } catch (err) {
      console.error("Error creating recipe:", err);
      setError(err instanceof Error ? err.message : "Failed to create recipe");
    }
  };

  const handleUpdateRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecipe) return;
    setError("");

    try {
      const ingredients = ingredientsText
        .split("\n")
        .map((i) => i.trim())
        .filter((i) => i.length > 0);

      await apiClient.updateRecipe(selectedRecipe.id, {
        ...formData,
        ingredients,
      });

      await loadRecipes();
      setActiveView("list");
      resetForm();
    } catch (err) {
      console.error("Error updating recipe:", err);
      setError(err instanceof Error ? err.message : "Failed to update recipe");
    }
  };

  const handleDeleteRecipe = async (id: string) => {
    if (!confirm("Are you sure you want to delete this recipe?")) return;
    setError("");

    try {
      await apiClient.deleteRecipe(id);
      await loadRecipes();
    } catch (err) {
      console.error("Error deleting recipe:", err);
      setError(err instanceof Error ? err.message : "Failed to delete recipe");
    }
  };

  const startEdit = (recipe: Recipe) => {
    setSelectedRecipe(recipe);
    setFormData({
      title: recipe.title,
      description: recipe.description,
      ingredients: recipe.ingredients,
    });
    setIngredientsText(recipe.ingredients.join("\n"));
    setActiveView("edit");
  };

  const resetForm = () => {
    setFormData({ title: "", description: "", ingredients: [] });
    setIngredientsText("");
    setSelectedRecipe(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ChefHat className="w-8 h-8 text-indigo-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  SAM Recipe Manager
                </h1>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Welcome, {userEmail}
                </p>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div className="mb-6 flex gap-4">
          <button
            onClick={() => {
              setActiveView("list");
              resetForm();
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              activeView === "list"
                ? "bg-indigo-600 text-white"
                : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            }`}
          >
            <List className="w-4 h-4" />
            All Recipes ({recipes.length})
          </button>
          <button
            onClick={() => {
              setActiveView("add");
              resetForm();
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              activeView === "add"
                ? "bg-indigo-600 text-white"
                : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            }`}
          >
            <Plus className="w-4 h-4" />
            Add Recipe
          </button>
        </div>

        {/* List View */}
        {activeView === "list" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {recipes.length === 0 ? (
              <div className="col-span-full text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
                <ChefHat className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 dark:text-gray-400 text-lg">
                  No recipes yet. Add your first recipe!
                </p>
              </div>
            ) : (
              recipes.map((recipe) => (
                <div
                  key={recipe.id}
                  onClick={() => startEdit(recipe)}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-lg transition-shadow p-6"
                >
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                    {recipe.title}
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400 mb-4 line-clamp-2">
                    {recipe.description}
                  </p>
                  <div className="mb-4">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Ingredients:
                    </p>
                    <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                      {recipe.ingredients.slice(0, 3).map((ingredient, idx) => (
                        <li key={idx} className="truncate">
                          • {ingredient}
                        </li>
                      ))}
                      {recipe.ingredients.length > 3 && (
                        <li className="text-indigo-600 dark:text-indigo-400">
                          + {recipe.ingredients.length - 3} more
                        </li>
                      )}
                    </ul>
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
                    <span className="text-xs text-gray-500 dark:text-gray-500">
                      {new Date(recipe.created_at).toLocaleDateString()}
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEdit(recipe)}
                        className="p-2 text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                        title="Edit recipe"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteRecipe(recipe.id)}
                        className="p-2 text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                        title="Delete recipe"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Add/Edit Form */}
        {(activeView === "add" || activeView === "edit") && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {activeView === "add" ? "Add New Recipe" : "Edit Recipe"}
                </h2>
                <button
                  onClick={() => {
                    setActiveView("list");
                    resetForm();
                  }}
                  className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form
                onSubmit={
                  activeView === "add" ? handleAddRecipe : handleUpdateRecipe
                }
              >
                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="title"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                    >
                      Recipe Title *
                    </label>
                    <input
                      id="title"
                      type="text"
                      required
                      value={formData.title}
                      onChange={(e) =>
                        setFormData({ ...formData, title: e.target.value })
                      }
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
                      placeholder="e.g., Chocolate Chip Cookies"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="description"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                    >
                      Description *
                    </label>
                    <textarea
                      id="description"
                      required
                      rows={3}
                      value={formData.description}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          description: e.target.value,
                        })
                      }
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
                      placeholder="A brief description of your recipe..."
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="ingredients"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                    >
                      Ingredients * (one per line)
                    </label>
                    <textarea
                      id="ingredients"
                      required
                      rows={6}
                      value={ingredientsText}
                      onChange={(e) => setIngredientsText(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white font-mono text-sm"
                      placeholder="2 cups flour&#10;1 cup sugar&#10;1 cup chocolate chips&#10;2 eggs"
                    />
                  </div>
                </div>

                <div className="flex gap-4 mt-6">
                  <button
                    type="submit"
                    className="flex-1 flex items-center justify-center gap-2 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    {activeView === "add" ? "Add Recipe" : "Update Recipe"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveView("list");
                      resetForm();
                    }}
                    className="px-6 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
