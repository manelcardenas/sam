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
import { NarrowRow } from "@/components/ui/NarrowRow";
import { Chip, ClearChip } from "@/components/ui/Chip";
import { EmptyPanel } from "@/components/profile/EmptyPanel";
import { RecipeRow } from "@/components/recipes/RecipeRow";
import { ArrowLeft, Plus, Edit, Trash2, ChefHat, SearchX } from "lucide-react";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import type { MessageKey } from "@/lib/i18n/dictionary";
import { formatDate } from "@/lib/format";

/**
 * The COOK world: every recipe in the collection, as one filterable list.
 *
 * It used to open on a four-tile category grid you tapped through to reach a
 * list — a full screen of navigation in front of 19 recipes, one tile of which
 * (Bebida) had never contained anything. `/dine` had already answered the same
 * question with chips (ADR 0005), so the two list pages ran on two
 * philosophies. Now there is one list, and category is a filter
 * (docs/plans/ux-refresh-plan.md §2).
 *
 * The empty category needs no decision under this shape: chips are built from
 * the categories that actually have recipes, so Bebida simply has no chip.
 */
export default function DashboardPage() {
  const { locale, t, tp } = useI18n();

  // Auth / loading
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");

  // Data
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [error, setError] = useState("");

  // Navigation state
  const [view, setView] = useState<DashboardView>("list");
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);

  // Narrowing state
  const [category, setCategory] = useState<FoodType | null>(null);
  const [query, setQuery] = useState("");

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
      setError(err instanceof Error ? err.message : t("dashboard.load-failed"));
    }
  };

  const handleCreate = async (data: CreateRecipeInput) => {
    await apiClient.createRecipe(data);
    await loadRecipes();
    setView("list");
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
      setError(err instanceof Error ? err.message : t("dashboard.delete-failed"));
      return;
    }
    setRecipeToDelete(null);
    await loadRecipes();
    // Back to the list, since the recipe is gone. Any filter survives, because
    // it describes what you were browsing, not what you just deleted.
    setSelectedRecipe(null);
    setView("list");
  };

  // ── Derived ─────────────────────────────────────────────────────────────────

  const needle = query.trim().toLowerCase();
  const shown = recipes.filter(
    (r) =>
      (!category || r.food_type === category) &&
      (!needle || r.title.toLowerCase().includes(needle)),
  );

  // Only categories that actually have recipes — an empty chip is a dead end,
  // the same rule the dine filters follow for cuisines.
  const present = FOOD_TYPES.filter((c) => recipes.some((r) => r.food_type === c.value));
  const narrowed = Boolean(needle || category);

  // ── URL sync ────────────────────────────────────────────────────────────────
  //
  // The URL is *derived* from the state rather than being pushed at each of the
  // transition sites: one place to reason about, and no call site has to
  // remember. Restoring runs the same mapping backwards.

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
      setCategory(next.category);
      setQuery(next.q);
      // Recipes must be loaded before an id can become an object; if a deep
      // link names one we don't have, fall back to the list rather than
      // rendering a detail view of nothing.
      const recipe = next.recipeId ? recipes.find((r) => r.id === next.recipeId) : null;
      setSelectedRecipe(recipe ?? null);
      if (next.recipeId && !recipe) setView("list");
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
    const query_ = toQuery({ view, category, recipeId: selectedRecipe?.id ?? null, q: query });
    const before = window.location.search;
    // Views push — that is what makes the back gesture work. Narrowing
    // replaces, so tweaking a filter five times doesn't cost five back presses
    // (lib/url-state.ts).
    const mode = view === "list" ? "replace" : "push";
    writeUrl(query_, mode);
    if (mode === "push" && window.location.search !== before) history.recordPush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, category, query, selectedRecipe?.id]);

  // ── Navigation helpers ───────────────────────────────────────────────────────

  const openRecipe = (recipe: Recipe) => {
    setSelectedRecipe(recipe);
    setView("detail");
  };

  const clearFilters = () => {
    setQuery("");
    setCategory(null);
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
    if (view === "edit") {
      setView("detail");
      return;
    }
    setView("list");
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <AppShell>
        <DashboardSkeleton />
      </AppShell>
    );
  }

  return (
    <AppShell userName={userName}>
      {/* Sub-toolbar: contextual back + new */}
      <div className="mb-6 flex items-center justify-between gap-3">
        {view !== "list" ? (
          <button
            onClick={goBack}
            className="flex h-10 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-sm font-semibold text-fg transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("common.back")}
          </button>
        ) : (
          <span />
        )}

        {view === "list" && (
          <button
            onClick={() => setView("add")}
            className="flex h-10 cursor-pointer items-center gap-1.5 rounded-full bg-tomato px-4 font-display text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            <Plus className="h-4 w-4" />
            {t("dashboard.new-recipe")}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border border-tomato/30 bg-tomato/10 px-4 py-3 text-sm font-medium text-tomato-700 dark:text-tomato">
          {error}
        </div>
      )}

      {/* ── LIST ── */}
      {view === "list" && (
        <div>
          <header className="mb-6">
            <h1 className="font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
              {t("dashboard.title")}
            </h1>
            <p className="mt-1.5 text-muted">
              {recipes.length > 0
                ? tp("dashboard.count", recipes.length)
                : t("dashboard.empty-collection")}
            </p>
          </header>

          {recipes.length === 0 ? (
            <EmptyPanel
              icon={<ChefHat className="mx-auto mb-3 h-10 w-10 text-muted" aria-hidden />}
              title={t("dashboard.no-recipes-title")}
              body={t("dashboard.no-recipes-body")}
              actionLabel={t("dashboard.no-recipes-action")}
              onAction={() => setView("add")}
            />
          ) : (
            <>
              <NarrowRow
                q={query}
                onQueryChange={setQuery}
                placeholder={t("dashboard.search-placeholder")}
                ariaLabel={t("dashboard.search-label")}
                resultCount={shown.length}
                countKey="recipe-row.ingredients"
                chips={
                  <>
                    {present.map((c) => (
                      <Chip
                        key={c.value}
                        active={category === c.value}
                        onClick={() => setCategory(category === c.value ? null : c.value)}
                      >
                        <c.icon className="h-3.5 w-3.5" aria-hidden />
                        {t(`food-types.${c.value}.label` as MessageKey)}
                      </Chip>
                    ))}
                    {narrowed && <ClearChip onClick={clearFilters} />}
                  </>
                }
              />

              {shown.length === 0 ? (
                <EmptyPanel
                  icon={<SearchX className="mx-auto mb-3 h-8 w-8 text-muted" aria-hidden />}
                  title={t("dashboard.no-match-title")}
                  body={t("dashboard.no-match-body")}
                  actionLabel={t("common.clear")}
                  onAction={clearFilters}
                />
              ) : (
                <ul className="space-y-3">
                  {shown.map((recipe, i) => (
                    <li
                      key={recipe.id}
                      // Stagger capped: past the first screenful the cascade reads as lag.
                      className={i < 8 ? "will-fetch animate-fetch-in" : undefined}
                      style={i < 8 ? { animationDelay: `${i * 45}ms` } : undefined}
                    >
                      <RecipeRow
                        recipe={recipe}
                        meta={recipe.created_by_name ?? undefined}
                        onClick={() => openRecipe(recipe)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {/* ── RECIPE DETAIL ── */}
      {view === "detail" && selectedRecipe && (() => {
        const meta = FOOD_TYPES.find((f) => f.value === selectedRecipe.food_type);
        const MetaIcon = meta?.icon;
        return (
          <article className="overflow-hidden rounded-4xl border border-line bg-surface shadow-paw">
            <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
              <div className="min-w-0">
                {meta && MetaIcon && (
                  <span
                    className="mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold"
                    style={{ backgroundColor: `${meta.accent}22`, color: meta.accent }}
                  >
                    <MetaIcon className="h-3.5 w-3.5" aria-hidden />
                    {t(`food-types.${meta.value}.label` as MessageKey)}
                  </span>
                )}
                <h1 className="font-display text-2xl font-bold text-fg sm:text-3xl">
                  {selectedRecipe.title}
                </h1>
                <p className="mt-1 text-xs text-muted">
                  {t("dashboard.by-and-dates", {
                    author: selectedRecipe.created_by_name ?? t("common.unknown"),
                    created: formatDate(selectedRecipe.created_at, locale),
                    updated: formatDate(selectedRecipe.updated_at, locale),
                  })}
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
                    title={t("common.edit")}
                    aria-label={t("dashboard.edit-aria")}
                    className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-amber/15 hover:text-amber-700 dark:hover:text-amber focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setRecipeToDelete(selectedRecipe)}
                    title={t("common.delete")}
                    aria-label={t("dashboard.delete-aria")}
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
                  {t("dashboard.instructions")}
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
            {t("dashboard.new-recipe-title")}
          </h1>
          <div className="rounded-4xl border border-line bg-surface p-6 shadow-paw">
            <RecipeForm
              // A category filter is a statement about what you were browsing,
              // so it seeds the form — you were looking at desserts, you are
              // probably adding one.
              initialData={
                category
                  ? { title: "", instructions: "", ingredients: { servings: null, items: [] }, food_type: category }
                  : undefined
              }
              onSubmit={handleCreate}
              onCancel={goBack}
              submitLabel={t("recipe-form.submit-add")}
            />
          </div>
        </div>
      )}

      {/* ── EDIT ── */}
      {view === "edit" && selectedRecipe && (
        <div className="mx-auto max-w-xl">
          <h1 className="mb-6 font-display text-2xl font-bold text-fg sm:text-3xl">
            {t("dashboard.edit-recipe-title")}
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
              submitLabel={t("common.save-changes")}
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
