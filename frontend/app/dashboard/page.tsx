"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthGate } from "@/components/auth/useAuthGate";
import { apiClient, type Recipe, type CreateRecipeInput, type GroceryItem, type MealPlan, type RecipeDraft } from "@/lib/api-client";
import { FOOD_TYPES } from "@/lib/constants";
import { RecipeFilterChips } from "@/components/recipes/RecipeFilterChips";
import { NO_FILTERS, filterRecipes, type RecipeFilterState } from "@/lib/recipe-filters";
import { canGoBack, currentParams, useBrowserNavigation, useTabHome, writeUrl } from "@/lib/url-state";
import { fromQuery, toQuery, type DashboardView } from "@/lib/dashboard-url";
import RecipeForm, { type RecipeFormValues } from "@/components/RecipeForm";
import { RecipeStart, type DraftOrigin, type ManualKind } from "@/components/recipes/RecipeStart";
import { rowsFromDraft, rowsFromRecipe } from "@/lib/recipe-review";
import { byKey } from "@/lib/grocery";
import { Loader } from "@/components/ui/Loader";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";
import SourceLink from "@/components/SourceLink";
import IngredientsPanel from "@/components/IngredientsPanel";
import { AppShell } from "@/components/shell/AppShell";
import { CompactButton } from "@/components/ui/Button";
import { DashboardSkeleton } from "@/components/ui/PageSkeleton";
import { NarrowRow } from "@/components/ui/NarrowRow";
import { EmptyPanel } from "@/components/profile/EmptyPanel";
import { RecipeRow } from "@/components/recipes/RecipeRow";
import { RecipePlanRow } from "@/components/recipes/RecipePlanRow";
import { weekStartOf } from "@/lib/plan-url";
import { ArrowLeft, Plus, Edit, Trash2, ChefHat, SearchX, NotebookPen, Clock, Lock } from "lucide-react";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import type { MessageKey } from "@/lib/i18n/dictionary";
import { formatDate } from "@/lib/format";
import { tagIcon, isQuick, QuickIcon, totalMinutes } from "@/lib/recipe-tags";

/** Where "new recipe" is: choosing how to start, or reviewing what that gave. */
type Adding = { stage: "start" } | { stage: "form"; initial: RecipeFormValues; origin?: DraftOrigin; simple: boolean };

const BLANK: Omit<RecipeFormValues, "rows"> = {
  title: "",
  instructions: "",
  food_type: "comida",
  source_url: "",
  prep_time_minutes: null,
  cook_time_minutes: null,
  tags: [],
  visibility: "public",
  servings: null,
  servingsFromSource: false,
  lines: [],
};

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
  // This week's plan, so a recipe can say when it is on the menu. Decoration:
  // it never blocks the page, and a failure costs only the "planned on" chips.
  const [week, setWeek] = useState<MealPlan | null>(null);
  const [error, setError] = useState("");

  // Navigation state
  const [view, setView] = useState<DashboardView>("list");
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);

  // Narrowing state — one object, because `RecipeFilterChips` owns the whole
  // vocabulary and the planner's picker holds the identical shape.
  const [filters, setFilters] = useState<RecipeFilterState>(NO_FILTERS);

  // Delete modal
  const [recipeToDelete, setRecipeToDelete] = useState<Recipe | null>(null);

  // Writing a recipe: how it started, the vocabulary its rows match against,
  // and the kitchen whose simple recipes this person may edit.
  const [adding, setAdding] = useState<Adding>({ stage: "start" });
  const [vocabulary, setVocabulary] = useState<GroceryItem[] | null>(null);
  const [kitchenId, setKitchenId] = useState<string | null>(null);
  const rowIds = useRef(0);
  const nextRowId = () => ++rowIds.current;

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
    void apiClient
      .getKitchen()
      .then((view) => {
        if (!cancelled) setKitchenId(view.kitchen.id);
      })
      .catch(() => undefined);
    void apiClient
      .getPlan(weekStartOf(new Date()))
      .then((plan) => {
        if (!cancelled) setWeek(plan);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  // The vocabulary is only needed while writing, so it loads when the form
  // opens rather than with the list. A failure costs the suggestions and the
  // aisles, never the form.
  useEffect(() => {
    if ((view !== "add" && view !== "edit") || vocabulary !== null) return;
    void apiClient
      .listGroceryItems()
      .then(setVocabulary)
      .catch(() => setVocabulary([]));
  }, [view, vocabulary]);

  // Every visit to "new" starts at the beginning — a half-reviewed draft from an
  // earlier visit is not something to come back to by surprise.
  useEffect(() => {
    if (view !== "add") setAdding({ stage: "start" });
  }, [view]);

  const startFromDraft = (draft: RecipeDraft, origin: DraftOrigin) =>
    setAdding({
      stage: "form",
      origin,
      simple: false,
      initial: {
        ...BLANK,
        title: draft.title ?? "",
        instructions: draft.instructions ?? "",
        food_type: filters.category ?? "comida",
        source_url: draft.source_url ?? "",
        prep_time_minutes: draft.prep_time_minutes,
        cook_time_minutes: draft.cook_time_minutes,
        tags: draft.tags,
        servings: draft.servings,
        servingsFromSource: draft.servings_from_source,
        rows: rowsFromDraft(draft, locale, nextRowId),
        lines: draft.ingredient_lines,
      },
    });

  const startByHand = (kind: ManualKind) => {
    const blankRow = () => ({ id: nextRowId(), name: "", amount: "", unit: "", optional: false });
    setAdding({
      stage: "form",
      simple: kind === "simple",
      initial: {
        ...BLANK,
        food_type: filters.category ?? "comida",
        // A simple recipe is written for one person and kept for the kitchen
        // (ADR 0009 §2); the plan multiplies it by whoever is eating.
        servings: kind === "simple" ? 1 : null,
        visibility: kind === "simple" ? "kitchen" : "public",
        rows: [blankRow(), blankRow(), blankRow()],
      },
    });
  };

  const canEdit = (recipe: Recipe) =>
    recipe.created_by === currentUserId || (recipe.visibility === "kitchen" && recipe.kitchen_id != null && recipe.kitchen_id === kitchenId);

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

  const shown = filterRecipes(recipes, filters);

  // ── URL sync ────────────────────────────────────────────────────────────────
  //
  // The URL is *derived* from the state rather than being pushed at each of the
  // transition sites: one place to reason about, and no call site has to
  // remember. Restoring runs the same mapping backwards.

  // Set while a popstate is being applied, so the writer below doesn't push a
  // new entry in response to the user going back — which would trap them.
  const applyingHistory = useRef(false);
  const urlRestored = useRef(false);

  const applyUrl = useCallback(
    (params: URLSearchParams) => {
      const next = fromQuery(params);
      applyingHistory.current = true;
      setView(next.view);
      setFilters({ q: next.q, category: next.category, authors: next.authors });
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

  useBrowserNavigation(applyUrl);

  useTabHome(() => {
    setSelectedRecipe(null);
    setView("list");
  });

  useEffect(() => {
    if (!urlRestored.current) return;
    if (applyingHistory.current) {
      applyingHistory.current = false;
      return;
    }
    const query_ = toQuery({ view, ...filters, recipeId: selectedRecipe?.id ?? null });
    // Views push — that is what makes the back gesture work. Narrowing
    // replaces, so tweaking a filter five times doesn't cost five back presses
    // (lib/url-state.ts).
    const mode = view === "list" ? "replace" : "push";
    writeUrl(query_, mode);

  }, [view, filters, selectedRecipe?.id]);

  // ── Navigation helpers ───────────────────────────────────────────────────────

  const openRecipe = (recipe: Recipe) => {
    setSelectedRecipe(recipe);
    setView("detail");
  };

  const clearFilters = () => setFilters(NO_FILTERS);

  const goBack = () => {
    // Defer to real history when there is any, so the in-app button and the
    // device gesture agree. Without this the button pushes *forward*, and the
    // gesture then walks back through views the user just dismissed.
    if (canGoBack()) {
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
      {/* Sub-toolbar: back, off the list. The list's "new" action sits beside its title. */}
      {view !== "list" && (
        <div className="mb-6 flex items-center justify-between gap-3">
          <button
            onClick={goBack}
            className="flex h-10 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-sm font-semibold text-fg transition-colors hover:border-accent/40 hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("common.back")}
          </button>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-medium text-danger-700 dark:text-danger">
          {error}
        </div>
      )}

      {/* ── LIST ── */}
      {view === "list" && (
        <div>
          <header className="mb-6 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
                {t("dashboard.title")}
              </h1>
              <p className="mt-1.5 text-muted">
                {recipes.length === 0 ? t("dashboard.empty-collection") : tp("dashboard.count", recipes.length)}
              </p>
            </div>
            {/* Beside the title, not on a row above it: there it cost ~90 px of
                a phone's first screen. Its icon alone on a phone (CompactButton). */}
            <CompactButton icon={Plus} label={t("dashboard.new-recipe")} onClick={() => setView("add")} className="shrink-0" />
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
                q={filters.q}
                onQueryChange={(q) => setFilters({ ...filters, q })}
                placeholder={t("dashboard.search-placeholder")}
                ariaLabel={t("dashboard.search-label")}
                resultCount={shown.length}
                countKey="recipe-row.ingredients"
                chips={
                  <RecipeFilterChips
                    recipes={recipes}
                    state={filters}
                    onChange={setFilters}
                    currentUserId={currentUserId}
                  />
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
                <RecipeFacts recipe={selectedRecipe} />
              </div>
              {canEdit(selectedRecipe) && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => setView("edit")}
                    title={t("common.edit")}
                    aria-label={t("dashboard.edit-aria")}
                    className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-amber/15 hover:text-amber-700 dark:hover:text-amber focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setRecipeToDelete(selectedRecipe)}
                    title={t("common.delete")}
                    aria-label={t("dashboard.delete-aria")}
                    className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-accent/15 hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-6 px-6 py-6">
              <RecipePlanRow recipe={selectedRecipe} week={week} />

              {/* No method means no heading — an Instructions heading over
                  nothing is the orphan ADR 0007 named. What replaces it is the
                  way to fix that, offered only to the person who can: the
                  owner taps straight into the editor. The trim matters, since
                  rows predating the API's normalisation can hold `""`. */}
              {selectedRecipe.instructions?.trim() ? (
                <section>
                  <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
                    {t("dashboard.instructions")}
                  </h2>
                  <p className="whitespace-pre-line leading-relaxed text-fg/90">
                    {selectedRecipe.instructions}
                  </p>
                </section>
              ) : (
                canEdit(selectedRecipe) && (
                  <button
                    type="button"
                    onClick={() => setView("edit")}
                    className="flex w-full cursor-pointer items-start gap-3 rounded-2xl border border-dashed border-line px-4 py-3.5 text-left transition-colors hover:border-amber/60 hover:bg-amber/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  >
                    <NotebookPen className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber" aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-fg">{t("dashboard.no-method-title")}</span>
                      <span className="mt-0.5 block text-sm text-muted">{t("dashboard.no-method-body")}</span>
                    </span>
                  </button>
                )
              )}

              <IngredientsPanel key={selectedRecipe.id} ingredients={selectedRecipe.ingredients} />
            </div>
          </article>
        );
      })()}

      {/* ── ADD ── */}
      {view === "add" && (
        <div className={`mx-auto ${adding.stage === "form" && adding.origin ? "max-w-xl lg:max-w-5xl" : "max-w-xl"}`}>
          <h1 className="mb-6 font-display text-2xl font-bold text-fg sm:text-3xl">
            {adding.stage === "form" && adding.simple ? t("dashboard.new-simple-recipe-title") : t("dashboard.new-recipe-title")}
          </h1>
          <div className="rounded-4xl border border-line bg-surface p-5 shadow-paw sm:p-6">
            {adding.stage === "start" ? (
              <RecipeStart onDraft={startFromDraft} onManual={startByHand} />
            ) : vocabulary === null ? (
              <Loader />
            ) : (
              <RecipeForm
                initial={adding.initial}
                origin={adding.origin}
                simple={adding.simple}
                vocabulary={vocabulary}
                nextId={nextRowId}
                onSubmit={handleCreate}
                onCancel={goBack}
                submitLabel={t("recipe-form.submit-add")}
              />
            )}
          </div>
        </div>
      )}

      {/* ── EDIT ── */}
      {view === "edit" && selectedRecipe && (
        <div className="mx-auto max-w-xl">
          <h1 className="mb-6 font-display text-2xl font-bold text-fg sm:text-3xl">
            {t("dashboard.edit-recipe-title")}
          </h1>
          <div className="rounded-4xl border border-line bg-surface p-5 shadow-paw sm:p-6">
            {vocabulary === null ? (
              <Loader />
            ) : (
              <RecipeForm
                initial={{
                  title: selectedRecipe.title,
                  instructions: selectedRecipe.instructions ?? "",
                  food_type: selectedRecipe.food_type,
                  source_url: selectedRecipe.source_url ?? "",
                  prep_time_minutes: selectedRecipe.prep_time_minutes,
                  cook_time_minutes: selectedRecipe.cook_time_minutes,
                  tags: selectedRecipe.tags ?? [],
                  visibility: selectedRecipe.visibility ?? "public",
                  servings: selectedRecipe.ingredients.servings,
                  servingsFromSource: false,
                  rows: rowsFromRecipe(selectedRecipe.ingredients, byKey(vocabulary), nextRowId),
                  lines: [],
                }}
                simple={selectedRecipe.visibility === "kitchen" && !selectedRecipe.instructions}
                vocabulary={vocabulary}
                nextId={nextRowId}
                onSubmit={handleUpdate}
                onCancel={goBack}
                submitLabel={t("common.save-changes")}
              />
            )}
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

/**
 * What the recipe is like, under its title: total time, ⚡ when it is quick,
 * its tags, and the lock when only the kitchen sees it. Said in words, with the
 * icons as a quick read, not instead of them.
 */
function RecipeFacts({ recipe }: { recipe: Recipe }) {
  const { t } = useI18n();
  const total = totalMinutes(recipe);
  const tags = recipe.tags ?? [];
  if (!total && tags.length === 0 && recipe.visibility !== "kitchen") return null;
  const pill = "inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-fg";
  return (
    <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t("recipe-form.tags")}>
      {total > 0 && (
        <li className={pill}>
          {isQuick(recipe) ? <QuickIcon className="h-3.5 w-3.5 text-amber-700 dark:text-amber" aria-hidden /> : <Clock className="h-3.5 w-3.5 text-muted" aria-hidden />}
          {t("recipe-form.total-minutes", { count: total })}
        </li>
      )}
      {tags.map((tag) => {
        const Icon = tagIcon(tag);
        return (
          <li key={tag} className={pill}>
            <Icon className="h-3.5 w-3.5 text-muted" aria-hidden />
            {t(`recipe-tags.${tag}`)}
          </li>
        );
      })}
      {recipe.visibility === "kitchen" && (
        <li className={pill}>
          <Lock className="h-3.5 w-3.5 text-muted" aria-hidden />
          {t("recipe-form.kitchen-only")}
        </li>
      )}
    </ul>
  );
}
