"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthGate } from "@/components/auth/useAuthGate";
import { apiClient, type Recipe, type CreateRecipeInput } from "@/lib/api-client";
import { FOOD_TYPES, type FoodType } from "@/lib/constants";
import { currentParams, useBrowserNavigation, useHistoryDepth, writeUrl } from "@/lib/url-state";
import { fromQuery, toQuery, type DashboardView } from "@/lib/dashboard-url";
import RecipeForm from "@/components/RecipeForm";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";
import SourceLink from "@/components/SourceLink";
import IngredientsPanel from "@/components/IngredientsPanel";
import { AppShell } from "@/components/shell/AppShell";
import { DashboardSkeleton } from "@/components/ui/PageSkeleton";
import { ArrowLeft, Plus, Edit, Trash2 } from "lucide-react";

export default function DashboardPage() {

  // Auth / loading
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");

  // Data
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [error, setError] = useState("");

  // Navigation state
  const [view, setView] = useState<DashboardView>("categories");
  const [activeCategory, setActiveCategory] = useState<FoodType | null>(null);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);

  // Delete modal
  const [recipeToDelete, setRecipeToDelete] = useState<Recipe | null>(null);

  // ── Auth ────────────────────────────────────────────────────────────────────

  // `me` comes from the session-wide provider, so this page no longer opens
  // with a serial GET /users/me. useAuthGate owns the redirects: signed-out to
  // the landing page, and no display name yet to /profile/complete.
  const { me } = useAuthGate();

  useEffect(() => {
    if (me?.display_name) setUserName(me.display_name);
  }, [me?.display_name]);

  // Keyed on the id alone: a background revalidation hands back an equivalent
  // profile object, and depending on `me` itself would refetch every recipe.
  useEffect(() => {
    if (!me?.id || !me.display_name) return;
    setCurrentUserId(me.id);
    let cancelled = false;
    void loadRecipes().then(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

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
    try {
      await apiClient.deleteRecipe(recipeToDelete.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete recipe");
      return;
    }
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

  // ── URL sync ────────────────────────────────────────────────────────────────
  //
  // The URL is *derived* from the view state rather than being pushed at each
  // of the ~8 transition sites: one place to reason about, and no call site has
  // to remember. Restoring runs the same mapping backwards.

  const history = useHistoryDepth();
  // Set while a popstate is being applied, so the writer below doesn't push a
  // new entry in response to the user going back — which would trap them.
  const applyingHistory = useRef(false);
  const urlRestored = useRef(false);

  const applyUrl = useCallback(
    (params: URLSearchParams) => {
      const next = fromQuery(params);
      applyingHistory.current = true;
      setView(next.view);
      setActiveCategory(next.category);
      // Recipes must be loaded before an id can become an object; if a deep
      // link names one we don't have, fall back to the category list rather
      // than rendering a detail view of nothing.
      const recipe = next.recipeId ? recipes.find((r) => r.id === next.recipeId) : null;
      setSelectedRecipe(recipe ?? null);
      if (next.recipeId && !recipe) setView(next.category ? "recipes" : "categories");
    },
    [recipes],
  );

  // Restore once, after the first load — `recipes` has to exist for ?recipe= to resolve.
  useEffect(() => {
    if (urlRestored.current || loading) return;
    urlRestored.current = true;
    applyUrl(currentParams());
  }, [loading, applyUrl]);

  useBrowserNavigation((params) => {
    history.recordPop();
    applyUrl(params);
  });

  useEffect(() => {
    if (!urlRestored.current) return;
    if (applyingHistory.current) {
      applyingHistory.current = false;
      return;
    }
    const query = toQuery({ view, category: activeCategory, recipeId: selectedRecipe?.id ?? null });
    const before = window.location.search;
    writeUrl(query, "push");
    if (window.location.search !== before) history.recordPush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, activeCategory, selectedRecipe?.id]);

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
    // Defer to real history when there is any, so the in-app button and the
    // device gesture agree. Without this the button pushes *forward*, and the
    // gesture then walks back through views the user just dismissed.
    if (history.canGoBack()) {
      window.history.back();
      return;
    }
    // Deep-linked straight into this view: nothing to pop, so step up a level.
    if (view === "edit") { setView("detail"); return; }
    if (view === "detail") { setView("recipes"); return; }
    setView("categories");
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <AppShell>
        <header className="mb-6">
          <h1 className="font-display text-3xl font-bold text-fg sm:text-4xl">
            What shall we fetch?
          </h1>
          <p className="mt-1 text-muted">Sniffing out your recipes…</p>
        </header>
        <DashboardSkeleton />
      </AppShell>
    );
  }

  return (
    <AppShell userName={userName}>
      {/* Sub-toolbar: contextual back + new */}
      <div className="mb-6 flex items-center justify-between gap-3">
        {view !== "categories" ? (
          <button
            onClick={goBack}
            className="flex h-10 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-sm font-semibold text-fg transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        ) : (
          <span />
        )}

        {(view === "categories" || view === "recipes") && (
          <button
            onClick={() => setView("add")}
            className="flex h-10 cursor-pointer items-center gap-1.5 rounded-full bg-tomato px-4 font-display text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            <Plus className="h-4 w-4" />
            New recipe
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border border-tomato/30 bg-tomato/10 px-4 py-3 text-sm font-medium text-tomato-700 dark:text-tomato">
          {error}
        </div>
      )}

      {/* ── CATEGORIES ── */}
      {view === "categories" && (
        <div>
          <header className="mb-6">
            <h1 className="font-display text-3xl font-bold text-fg sm:text-4xl">
              What shall we fetch?
            </h1>
            <p className="mt-1 text-muted">Pick a kind of dish to dig into.</p>
          </header>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {FOOD_TYPES.map((cat, i) => {
              const count = recipes.filter((r) => r.food_type === cat.value).length;
              return (
                <button
                  key={cat.value}
                  onClick={() => openCategory(cat.value)}
                  style={{ animationDelay: `${i * 80}ms` }}
                  className="group relative cursor-pointer overflow-hidden rounded-3xl border border-line bg-surface p-5 text-left transition-all duration-200 will-fetch animate-fetch-in hover:-translate-y-1 hover:shadow-paw focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                >
                  <span
                    aria-hidden
                    className="absolute inset-0 opacity-[0.08] transition-opacity duration-200 group-hover:opacity-[0.16]"
                    style={{ backgroundColor: cat.accent }}
                  />
                  <span className="relative flex flex-col gap-3">
                    <span
                      className="grid h-14 w-14 place-items-center rounded-2xl text-3xl"
                      style={{ backgroundColor: `${cat.accent}22` }}
                    >
                      {cat.emoji}
                    </span>
                    <span>
                      <span className="block font-display text-lg font-semibold text-fg">
                        {cat.label}
                      </span>
                      <span className="mt-0.5 block text-sm text-muted">
                        {cat.description}
                      </span>
                    </span>
                    <span
                      className="text-sm font-bold"
                      style={{ color: cat.accent }}
                    >
                      {count} {count === 1 ? "recipe" : "recipes"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── RECIPES LIST ── */}
      {view === "recipes" && categoryMeta && (
        <div>
          <header className="mb-6 flex items-center gap-3">
            <span
              className="grid h-12 w-12 place-items-center rounded-2xl text-2xl"
              style={{ backgroundColor: `${categoryMeta.accent}22` }}
            >
              {categoryMeta.emoji}
            </span>
            <div>
              <h1 className="font-display text-2xl font-bold text-fg">
                {categoryMeta.label}
              </h1>
              <p className="text-sm text-muted">
                {categoryRecipes.length} {categoryRecipes.length === 1 ? "recipe" : "recipes"}
              </p>
            </div>
          </header>

          {categoryRecipes.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-line bg-surface py-16 text-center">
              <p className="mb-3 text-5xl">{categoryMeta.emoji}</p>
              <p className="text-muted">
                No {categoryMeta.label.toLowerCase()} recipes yet.
              </p>
              <button
                onClick={() => setView("add")}
                className="mt-5 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-tomato px-4 py-2.5 font-display text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95"
              >
                <Plus className="h-4 w-4" />
                Add one
              </button>
            </div>
          ) : (
            <ul className="space-y-3">
              {categoryRecipes.map((recipe, i) => (
                <li
                  key={recipe.id}
                  className="will-fetch animate-fetch-in"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <button
                    onClick={() => openRecipe(recipe)}
                    className="group flex w-full cursor-pointer items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-5 py-4 text-left transition-all hover:-translate-y-0.5 hover:border-tomato/40 hover:shadow-paw focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                  >
                    <span className="font-display font-semibold text-fg transition-colors group-hover:text-tomato">
                      {recipe.title}
                    </span>
                    <span className="ml-4 shrink-0 text-xs text-muted">
                      {recipe.ingredients.items.length} ingredients · by{" "}
                      {recipe.created_by_name ?? "Unknown"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── RECIPE DETAIL ── */}
      {view === "detail" && selectedRecipe && (() => {
        const meta = FOOD_TYPES.find((f) => f.value === selectedRecipe.food_type);
        return (
          <article className="overflow-hidden rounded-4xl border border-line bg-surface shadow-paw">
            <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
              <div className="min-w-0">
                {meta && (
                  <span
                    className="mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold"
                    style={{ backgroundColor: `${meta.accent}22`, color: meta.accent }}
                  >
                    {meta.emoji} {meta.label}
                  </span>
                )}
                <h1 className="font-display text-2xl font-bold text-fg sm:text-3xl">
                  {selectedRecipe.title}
                </h1>
                <p className="mt-1 text-xs text-muted">
                  By {selectedRecipe.created_by_name ?? "Unknown"} · Created{" "}
                  {new Date(selectedRecipe.created_at).toLocaleDateString()} · Updated{" "}
                  {new Date(selectedRecipe.updated_at).toLocaleDateString()}
                </p>
                {selectedRecipe.source_url && (
                  <div className="mt-2">
                    <SourceLink url={selectedRecipe.source_url} />
                  </div>
                )}
              </div>
              {selectedRecipe.created_by === currentUserId && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => setView("edit")}
                    title="Edit"
                    aria-label="Edit recipe"
                    className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-amber/15 hover:text-amber-700 dark:hover:text-amber focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setRecipeToDelete(selectedRecipe)}
                    title="Delete"
                    aria-label="Delete recipe"
                    className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-tomato/15 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-6 px-6 py-6">
              <section>
                <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
                  Instructions
                </h2>
                <p className="whitespace-pre-line leading-relaxed text-fg/90">
                  {selectedRecipe.instructions}
                </p>
              </section>

              <IngredientsPanel key={selectedRecipe.id} ingredients={selectedRecipe.ingredients} />
            </div>
          </article>
        );
      })()}

      {/* ── ADD ── */}
      {view === "add" && (
        <div className="mx-auto max-w-xl">
          <h1 className="mb-6 font-display text-2xl font-bold text-fg sm:text-3xl">
            New recipe
          </h1>
          <div className="rounded-4xl border border-line bg-surface p-6 shadow-paw">
            <RecipeForm
              initialData={
                activeCategory
                  ? { title: "", instructions: "", ingredients: { servings: null, items: [] }, food_type: activeCategory }
                  : undefined
              }
              onSubmit={handleCreate}
              onCancel={goBack}
              submitLabel="Add recipe"
            />
          </div>
        </div>
      )}

      {/* ── EDIT ── */}
      {view === "edit" && selectedRecipe && (
        <div className="mx-auto max-w-xl">
          <h1 className="mb-6 font-display text-2xl font-bold text-fg sm:text-3xl">
            Edit recipe
          </h1>
          <div className="rounded-4xl border border-line bg-surface p-6 shadow-paw">
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
              submitLabel="Save changes"
            />
          </div>
        </div>
      )}

      {/* ── DELETE MODAL ── */}
      {recipeToDelete && (
        <DeleteConfirmModal
          recipeName={recipeToDelete.title}
          onConfirm={handleDelete}
          onCancel={() => setRecipeToDelete(null)}
        />
      )}
    </AppShell>
  );
}
