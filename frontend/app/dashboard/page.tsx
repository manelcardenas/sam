"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser, signOut } from "aws-amplify/auth";
import { configureAmplify } from "@/lib/amplify";
import { apiClient, type Recipe, type CreateRecipeInput } from "@/lib/api-client";
import { FOOD_TYPES, type FoodType } from "@/lib/constants";
import RecipeForm from "@/components/RecipeForm";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";
import SourceLink from "@/components/SourceLink";
import { LogOut, ChefHat, Plus, ArrowLeft, Edit, Trash2, User } from "lucide-react";

type View = "categories" | "recipes" | "detail" | "add" | "edit";

export default function DashboardPage() {
  const router = useRouter();

  // Auth / loading
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState("");

  // Data
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [error, setError] = useState("");

  // Navigation state
  const [view, setView] = useState<View>("categories");
  const [activeCategory, setActiveCategory] = useState<FoodType | null>(null);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);

  // Delete modal
  const [recipeToDelete, setRecipeToDelete] = useState<Recipe | null>(null);

  // ── Auth ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    configureAmplify();
    (async () => {
      try {
        await getCurrentUser();
        const me = await apiClient.getMe();
        // First-login gate: a NULL name means they haven't chosen one yet.
        if (!me.display_name) {
          router.replace("/profile/complete");
          return;
        }
        setUserName(me.display_name);
        await loadRecipes();
        setLoading(false);
      } catch {
        router.push("/");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut({ global: true });
    } finally {
      router.push("/");
    }
  };

  // ── Data ────────────────────────────────────────────────────────────────────

  const loadRecipes = async () => {
    try {
      setError("");
      setRecipes(await apiClient.listRecipes());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load recipes");
    }
  };

  const handleCreate = async (data: CreateRecipeInput) => {
    await apiClient.createRecipe(data);
    await loadRecipes();
    setView("categories");
  };

  const handleUpdate = async (data: CreateRecipeInput) => {
    if (!selectedRecipe) return;
    const updated = await apiClient.updateRecipe(selectedRecipe.id, data);
    await loadRecipes();
    setSelectedRecipe(updated);
    setView("detail");
  };

  const handleDelete = async () => {
    if (!recipeToDelete) return;
    await apiClient.deleteRecipe(recipeToDelete.id);
    setRecipeToDelete(null);
    await loadRecipes();
    // Return to category list, since the recipe is gone
    setSelectedRecipe(null);
    setView("recipes");
  };

  // ── Derived ─────────────────────────────────────────────────────────────────

  const categoryRecipes = activeCategory
    ? recipes.filter((r) => r.food_type === activeCategory)
    : [];

  const categoryMeta = FOOD_TYPES.find((f) => f.value === activeCategory);

  // ── Navigation helpers ───────────────────────────────────────────────────────

  const openCategory = (cat: FoodType) => {
    setActiveCategory(cat);
    setView("recipes");
  };

  const openRecipe = (recipe: Recipe) => {
    setSelectedRecipe(recipe);
    setView("detail");
  };

  const goBack = () => {
    if (view === "edit") { setView("detail"); return; }
    if (view === "detail") { setView("recipes"); return; }
    if (view === "recipes") { setView("categories"); return; }
    if (view === "add") { setView("categories"); return; }
    setView("categories");
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto" />
          <p className="mt-4 text-gray-500 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* ── Header ── */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {view !== "categories" && (
              <button
                onClick={goBack}
                className="p-1.5 -ml-1 rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                aria-label="Back"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <ChefHat className="w-7 h-7 text-indigo-600 shrink-0" />
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-tight">
                SAM Recipe Manager
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">{userName}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Add recipe — available from categories and recipe list */}
            {(view === "categories" || view === "recipes") && (
              <button
                onClick={() => setView("add")}
                className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                New
              </button>
            )}
            <button
              onClick={() => router.push("/profile")}
              title="Profile"
              aria-label="Profile"
              className="p-2 rounded-full text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <User className="w-5 h-5" />
            </button>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* ── CATEGORIES VIEW ── */}
        {view === "categories" && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
              What are you looking for?
            </h2>
            <div className="grid grid-cols-2 gap-4">
              {FOOD_TYPES.map((cat) => {
                const count = recipes.filter((r) => r.food_type === cat.value).length;
                return (
                  <button
                    key={cat.value}
                    onClick={() => openCategory(cat.value)}
                    className="group flex flex-col items-start gap-3 p-6 bg-white dark:bg-gray-800 rounded-2xl shadow-sm hover:shadow-md border border-gray-100 dark:border-gray-700 hover:border-indigo-200 dark:hover:border-indigo-700 transition-all duration-200 text-left"
                  >
                    <span className="text-4xl">{cat.emoji}</span>
                    <div>
                      <p className="text-lg font-semibold text-gray-900 dark:text-white group-hover:text-indigo-700 dark:group-hover:text-indigo-300 transition-colors">
                        {cat.label}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {cat.description}
                      </p>
                      <p className="mt-1 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                        {count} {count === 1 ? "recipe" : "recipes"}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── RECIPES LIST VIEW ── */}
        {view === "recipes" && categoryMeta && (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <span className="text-3xl">{categoryMeta.emoji}</span>
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {categoryMeta.label}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {categoryRecipes.length} {categoryRecipes.length === 1 ? "recipe" : "recipes"}
                </p>
              </div>
            </div>

            {categoryRecipes.length === 0 ? (
              <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700">
                <p className="text-4xl mb-3">{categoryMeta.emoji}</p>
                <p className="text-gray-500 dark:text-gray-400">
                  No {categoryMeta.label.toLowerCase()} recipes yet.
                </p>
                <button
                  onClick={() => setView("add")}
                  className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add one
                </button>
              </div>
            ) : (
              <ul className="space-y-2">
                {categoryRecipes.map((recipe) => (
                  <li key={recipe.id}>
                    <button
                      onClick={() => openRecipe(recipe)}
                      className="w-full flex items-center justify-between px-5 py-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 hover:border-indigo-200 dark:hover:border-indigo-700 hover:shadow-sm transition-all text-left group"
                    >
                      <span className="font-medium text-gray-900 dark:text-white group-hover:text-indigo-700 dark:group-hover:text-indigo-300 transition-colors">
                        {recipe.title}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 ml-4">
                        {recipe.ingredients.items.length} ingredients &middot; by {recipe.created_by_name ?? "Unknown"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── RECIPE DETAIL VIEW ── */}
        {view === "detail" && selectedRecipe && (() => {
          const meta = FOOD_TYPES.find((f) => f.value === selectedRecipe.food_type);
          return (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
              {/* Title bar */}
              <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-700 flex items-start justify-between gap-4">
                <div>
                  {meta && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 mb-2">
                      {meta.emoji} {meta.label}
                    </span>
                  )}
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                    {selectedRecipe.title}
                  </h2>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    By {selectedRecipe.created_by_name ?? "Unknown"} &middot; Created {new Date(selectedRecipe.created_at).toLocaleDateString()} &middot; Updated {new Date(selectedRecipe.updated_at).toLocaleDateString()}
                  </p>
                  {selectedRecipe.source_url && (
                    <div className="mt-2">
                      <SourceLink url={selectedRecipe.source_url} />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setView("edit")}
                    className="p-2 rounded-lg text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                    title="Edit"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setRecipeToDelete(selectedRecipe)}
                    className="p-2 rounded-lg text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-6">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
                    Instructions
                  </h3>
                  <p className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">
                    {selectedRecipe.instructions}
                  </p>
                </div>

                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
                    Ingredients ({selectedRecipe.ingredients.items.length})
                    {selectedRecipe.ingredients.servings && (
                      <span className="ml-2 font-normal text-gray-400 dark:text-gray-500">
                        · {selectedRecipe.ingredients.servings} servings
                      </span>
                    )}
                  </h3>
                  <ul className="space-y-1.5">
                    {selectedRecipe.ingredients.items.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2.5 text-gray-700 dark:text-gray-300">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                        {item.amount != null && item.unit
                          ? `${item.amount} ${item.unit} ${item.name}`
                          : item.amount != null
                            ? `${item.amount} ${item.name}`
                            : item.name}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── ADD FORM ── */}
        {view === "add" && (
          <div className="max-w-xl mx-auto">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
              New Recipe
            </h2>
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6">
              <RecipeForm
                initialData={
                  activeCategory
                    ? { title: "", instructions: "", ingredients: { servings: null, items: [] }, food_type: activeCategory }
                    : undefined
                }
                onSubmit={handleCreate}
                onCancel={goBack}
                submitLabel="Add Recipe"
              />
            </div>
          </div>
        )}

        {/* ── EDIT FORM ── */}
        {view === "edit" && selectedRecipe && (
          <div className="max-w-xl mx-auto">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
              Edit Recipe
            </h2>
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6">
              <RecipeForm
                initialData={{
                  title: selectedRecipe.title,
                  instructions: selectedRecipe.instructions,
                  ingredients: selectedRecipe.ingredients,
                  food_type: selectedRecipe.food_type,
                  source_url: selectedRecipe.source_url ?? undefined,
                }}
                onSubmit={handleUpdate}
                onCancel={goBack}
                submitLabel="Save Changes"
              />
            </div>
          </div>
        )}
      </main>

      {/* ── DELETE MODAL ── */}
      {recipeToDelete && (
        <DeleteConfirmModal
          recipeName={recipeToDelete.title}
          onConfirm={handleDelete}
          onCancel={() => setRecipeToDelete(null)}
        />
      )}
    </div>
  );
}
