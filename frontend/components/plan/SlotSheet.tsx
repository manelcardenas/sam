"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Minus, Plus, Search, Trash2, Users, X } from "lucide-react";
import type { MealPlan, PlanEntry, Recipe } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { findExistingLine, formatAmount, linesFromEntry, scaleIngredients, type ScaledLine } from "@/lib/plan-ingredients";
import { RecipeFilterChips } from "@/components/recipes/RecipeFilterChips";
import { NO_FILTERS, filterRecipes, type RecipeFilterState } from "@/lib/recipe-filters";

type Step = "pick" | "ingredients" | "confirm-remove";

/**
 * The one modal the planner has: everything you do to a slot happens here.
 *
 * The flow it implements is §2's, in order — pick a recipe and a headcount, then
 * see its ingredients **already ticked** and untick what you have. The two steps
 * are one sheet rather than two screens because they are one decision: you
 * choose spaghetti *for four* and the amounts follow, so splitting them would
 * make you commit to the recipe before seeing what it costs you at the shop.
 *
 * Skipping the ingredient step is allowed, and the slot shows afterwards that
 * you did — see WeekGrid's basket icon. A step you cannot skip is a step people
 * learn to rush.
 */
export function SlotSheet({
  plan,
  entry,
  dayLabel,
  mealLabel,
  recipes,
  editable,
  listEditable,
  onAssign,
  onAddToList,
  onRemove,
  onClose,
  currentUserId,
}: {
  plan: MealPlan | null;
  entry: PlanEntry | undefined;
  dayLabel: string;
  mealLabel: string;
  recipes: Recipe[];
  editable: boolean;
  listEditable: boolean;
  onAssign: (recipe: Recipe | null, name: string, servings: number) => Promise<PlanEntry | null>;
  onAddToList: (entry: PlanEntry, lines: ScaledLine[]) => Promise<void>;
  onRemove: (entry: PlanEntry, dropFromList: boolean) => Promise<void>;
  onClose: () => void;
  /** For ordering the author chips — you come first in your own collection. */
  currentUserId: string | null;
}) {
  const { t, tp } = useI18n();
  const [step, setStep] = useState<Step>(entry ? "ingredients" : "pick");
  // Same shape `/dashboard` holds, through the same component. Deliberately
  // *not* the same instance: the sheet is mounted per open, so it always starts
  // unnarrowed rather than inheriting chips tapped on another page.
  //
  // `q` does double duty here, as it always has — it narrows the list, and if you
  // assign without picking anything it becomes the name of a one-off entry.
  const [filters, setFilters] = useState<RecipeFilterState>(NO_FILTERS);
  const [picked, setPicked] = useState<Recipe | null>(null);
  const [servings, setServings] = useState(entry?.servings ?? 2);
  const [busy, setBusy] = useState(false);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  // The entry this sheet is working with: the one passed in, or the one just
  // created. Held locally so the ingredient step works before the parent has
  // refetched.
  const [working, setWorking] = useState<PlanEntry | undefined>(entry);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // The page behind must not scroll while a sheet covers it — on a phone that
    // reads as the sheet itself being broken.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const recipeFor = working?.recipe_id ? recipes.find((r) => r.id === working.recipe_id) : undefined;
  const source = step === "pick" ? picked : (recipeFor ?? picked);

  const lines = useMemo(
    () => (source ? scaleIngredients(source.ingredients, working?.servings ?? servings) : []),
    [source, working?.servings, servings],
  );

  /** What the list already holds for a line, so the popup shows the running
   *  total *before* you decide rather than after (§4.6). */
  const alreadyOnList = (line: ScaledLine): string | null => {
    const existing = findExistingLine(plan?.items ?? [], line);
    if (!existing) return null;
    // A line already there with no quantity still deserves saying so — "sal" is
    // on the list even though the list cannot say how much.
    return formatAmount(existing.total_amount, existing.unit) ?? "✓";
  };

  const shown = useMemo(() => filterRecipes(recipes, filters), [recipes, filters]);

  const assign = async () => {
    if (!picked && !filters.q.trim()) return;
    setBusy(true);
    try {
      const saved = await onAssign(picked, picked?.title ?? filters.q.trim(), servings);
      if (saved) {
        setWorking(saved);
        setUnticked(new Set());
        setStep("ingredients");
      }
    } finally {
      setBusy(false);
    }
  };

  const addToList = async () => {
    if (!working) return;
    setBusy(true);
    try {
      await onAddToList(working, lines.filter((l) => !unticked.has(l.id)));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (dropFromList: boolean) => {
    if (!working) return;
    setBusy(true);
    try {
      await onRemove(working, dropFromList);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const listedCount = working ? linesFromEntry(plan?.items ?? [], working).length : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${dayLabel} · ${mealLabel}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        // Bottom sheet on a phone, centred card on a desktop. The planner is
        // used one-handed in a kitchen and a supermarket, and the bottom of the
        // screen is the half of it a thumb reaches.
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-4xl border border-line bg-surface shadow-paw sm:rounded-4xl will-fetch animate-fetch-in"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className="text-[0.7rem] font-bold uppercase tracking-wider text-muted">{dayLabel}</p>
            <h2 className="font-display text-lg font-bold text-fg">
              {step === "pick" ? t("plan.choose-dish") : (working?.dish_name ?? mealLabel)}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {step === "pick" && (
            <PickStep
              filters={filters}
              onFiltersChange={setFilters}
              all={recipes}
              currentUserId={currentUserId}
              recipes={shown}
              total={recipes.length}
              picked={picked}
              onPick={setPicked}
              servings={servings}
              onServingsChange={setServings}
            />
          )}

          {step === "ingredients" && (
            <IngredientsStep
              lines={lines}
              unticked={unticked}
              onToggle={(id) =>
                setUnticked((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              alreadyOnList={alreadyOnList}
              listedCount={listedCount}
            />
          )}

          {step === "confirm-remove" && working && (
            <div className="space-y-3">
              <p className="text-fg">
                {t("plan.remove-recipe-confirm", { recipe: working.dish_name, day: `${dayLabel} · ${mealLabel}` })}
              </p>
              {/* §4.5: the list never rewrites itself. Both outcomes are
                  offered as real choices rather than one being a checkbox on
                  the other. */}
              <button
                type="button"
                disabled={busy}
                onClick={() => remove(false)}
                className="w-full cursor-pointer rounded-2xl border border-line bg-surface px-4 py-3 text-left text-sm font-semibold text-fg transition-colors hover:border-tomato/40 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
              >
                {t("plan.remove-and-keep")}
              </button>
              {listedCount > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => remove(true)}
                  className="w-full cursor-pointer rounded-2xl border border-tomato/40 bg-tomato/10 px-4 py-3 text-left text-sm font-semibold text-tomato-700 transition-colors hover:bg-tomato/15 disabled:opacity-50 dark:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                >
                  {tp("plan.remove-and-drop", listedCount)}
                </button>
              )}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-4">
          {step === "pick" && (
            <button
              type="button"
              onClick={assign}
              disabled={busy || (!picked && !filters.q.trim())}
              className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-tomato px-4 py-3 font-display text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
            >
              <Check className="h-4 w-4" />
              {t("plan.assign")}
            </button>
          )}

          {step === "ingredients" && working && (
            <>
              {editable && (
                <button
                  type="button"
                  onClick={() => setStep("confirm-remove")}
                  aria-label={t("plan.remove-recipe")}
                  title={t("plan.remove-recipe")}
                  className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-tomato/15 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              {editable && (
                <button
                  type="button"
                  onClick={() => {
                    setPicked(recipeFor ?? null);
                    setFilters(NO_FILTERS);
                    setServings(working.servings);
                    setStep("pick");
                  }}
                  className="cursor-pointer rounded-full border border-line px-4 py-3 text-sm font-semibold text-fg transition-colors hover:border-tomato/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                >
                  {t("plan.change-recipe")}
                </button>
              )}
              <button
                type="button"
                onClick={addToList}
                disabled={busy || lines.length === 0 || !listEditable}
                className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-tomato px-4 py-3 font-display text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
              >
                {t("plan.add-to-list")}
              </button>
            </>
          )}

          {step === "confirm-remove" && (
            <button
              type="button"
              onClick={() => setStep("ingredients")}
              className="flex-1 cursor-pointer rounded-full border border-line px-4 py-3 text-sm font-semibold text-fg transition-colors hover:border-tomato/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
            >
              {t("common.cancel")}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function PickStep({
  filters,
  onFiltersChange,
  all,
  currentUserId,
  recipes,
  total,
  picked,
  onPick,
  servings,
  onServingsChange,
}: {
  filters: RecipeFilterState;
  onFiltersChange: (next: RecipeFilterState) => void;
  /** The unfiltered collection — what the chips may offer. */
  all: Recipe[];
  currentUserId: string | null;
  /** Already narrowed — what the list shows. */
  recipes: Recipe[];
  total: number;
  picked: Recipe | null;
  onPick: (r: Recipe | null) => void;
  servings: number;
  onServingsChange: (n: number) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          type="search"
          value={filters.q}
          onChange={(e) => onFiltersChange({ ...filters, q: e.target.value })}
          aria-label={t("plan.search-recipes")}
          placeholder={t("plan.search-recipes-placeholder")}
          className="h-11 w-full rounded-2xl border border-line bg-surface pl-10 pr-4 text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30"
        />
      </div>

      {/* The same row `/dashboard` shows, from the same component, so a filter
          added there exists here without anyone remembering to add it twice. It
          renders nothing when the collection is too small to distinguish — which
          is what keeps a bottom sheet from spending a line of a phone screen on
          chips that all select everything. */}
      <div className="rail-scroll -mx-5 flex flex-nowrap items-center gap-2 overflow-x-auto px-5 empty:hidden">
        <RecipeFilterChips recipes={all} state={filters} onChange={onFiltersChange} currentUserId={currentUserId} />
      </div>

      {/* Headcount sits with the picker, not after it: "spaghetti for four" is
          one thought, and the amounts on the next step depend on it. */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Users className="h-4 w-4 text-muted" aria-hidden />
          {t("plan.how-many")}
        </span>
        <span className="flex items-center gap-1">
          <Stepper label="−" onClick={() => onServingsChange(Math.max(1, servings - 1))} disabled={servings <= 1} icon={<Minus className="h-4 w-4" />} />
          <span className="w-9 text-center font-display text-lg font-bold tabular-nums text-fg">{servings}</span>
          <Stepper label="+" onClick={() => onServingsChange(Math.min(99, servings + 1))} disabled={servings >= 99} icon={<Plus className="h-4 w-4" />} />
        </span>
      </div>

      {total === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{t("plan.no-recipes-at-all")}</p>
      ) : recipes.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{t("plan.no-matches")}</p>
      ) : (
        <ul className="space-y-1.5">
          {recipes.map((recipe) => {
            const on = picked?.id === recipe.id;
            return (
              <li key={recipe.id}>
                <button
                  type="button"
                  onClick={() => onPick(on ? null : recipe)}
                  aria-pressed={on}
                  className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 ${
                    on ? "border-tomato bg-tomato/10" : "border-line hover:border-tomato/40"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-fg">{recipe.title}</span>
                    <span className="block text-xs text-muted">
                      {recipe.ingredients.items.length > 0
                        ? recipe.ingredients.items.map((i) => i.name).slice(0, 3).join(" · ")
                        : t("plan.no-ingredients")}
                    </span>
                  </span>
                  {on && <Check className="h-4 w-4 shrink-0 text-tomato" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Stepper({ label, onClick, disabled, icon }: { label: string; onClick: () => void; disabled: boolean; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line text-fg transition-colors hover:border-tomato/50 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
    >
      {icon}
    </button>
  );
}

function IngredientsStep({
  lines,
  unticked,
  onToggle,
  alreadyOnList,
  listedCount,
}: {
  lines: ScaledLine[];
  unticked: Set<string>;
  onToggle: (id: string) => void;
  alreadyOnList: (line: ScaledLine) => string | null;
  listedCount: number;
}) {
  const { t } = useI18n();

  if (lines.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">{t("plan.no-ingredients")}</p>;
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-display text-sm font-bold text-fg">{t("plan.ingredients-title")}</h3>
        <p className="mt-0.5 text-sm text-muted">{t("plan.ingredients-body")}</p>
      </div>

      <ul className="space-y-1">
        {lines.map((line) => {
          const on = !unticked.has(line.id);
          const existing = alreadyOnList(line);
          return (
            <li key={line.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl px-2 py-2.5 transition-colors hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onToggle(line.id)}
                  className="h-5 w-5 shrink-0 cursor-pointer accent-tomato"
                />
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${on ? "text-fg" : "text-muted line-through"}`}>{line.name}</span>
                  {existing && (
                    // The running total before you decide, not after — §4.6's
                    // annotation. Unticks are deliberately not remembered across
                    // recipes, so being asked twice is normal and this is what
                    // makes the second ask quick.
                    <span className="block text-xs text-muted">{t("plan.already-added", { amount: existing })}</span>
                  )}
                </span>
                {line.label && <span className="shrink-0 text-sm font-semibold tabular-nums text-muted">{line.label}</span>}
              </label>
            </li>
          );
        })}
      </ul>

      {listedCount > 0 && (
        <p className="rounded-2xl bg-surface-2 px-4 py-2.5 text-xs text-muted">
          {t("plan.on-the-list")} · {listedCount}
        </p>
      )}
    </div>
  );
}
