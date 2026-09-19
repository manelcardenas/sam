"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Minus, Plus, Search, Sparkles, Trash2, Users, X } from "lucide-react";
import type { CreateRecipeInput, GroceryItem, MealPlan, PlanEntry, Recipe } from "@/lib/api-client";
import type { FoodType } from "@/lib/constants";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { findExistingLine, formatAmount, linesFromEntry, scaleIngredients, type ScaledLine } from "@/lib/plan-ingredients";
import { RecipeFilterChips } from "@/components/recipes/RecipeFilterChips";
import { NO_FILTERS, filterRecipes, type RecipeFilterState } from "@/lib/recipe-filters";
import { IngredientCapture, type CaptureRow } from "@/components/IngredientCapture";
import { FoodTypePicker } from "@/components/FoodTypePicker";
import { byKey, resolveKey } from "@/lib/grocery";

type Step = "dishes" | "pick" | "create" | "ingredients" | "confirm-remove";

/** A guarnición per person, which is what §5.4 says the default has to be. */
const BLANK_DRAFT = { title: "", type: "guarnicion" as FoodType, servings: 1, touched: false };

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
 *
 * **A slot holds several dishes** (ingredient-capture-plan §5), so a filled slot
 * now opens on its list rather than straight into one dish's ingredients. They
 * are equal — there is no main and no side, because "ensalada con pollo" has no
 * answer to which is which and nothing would behave differently if it did.
 *
 * **There is no "change recipe" any more.** It meant something when a slot held
 * one dish; with a list it would have to mean "replace this one", which is
 * remove-then-add spelled less clearly. Two obvious taps beat one ambiguous one.
 *
 * **You can create a dish without leaving the sheet** (§5.3). Discovering you
 * need `Arroz blanco` happens while you are planning Tuesday, and if that means
 * abandoning the plan for `cook` and coming back, nobody does it — they type
 * `arroz` as a one-off text entry, which is one tap away in this same picker and
 * puts *nothing* on the shopping list. That is not a polish gap; it is the
 * failure mode that would make `guarnicion` pointless.
 *
 * The headcount is **one stepper for the whole slot**, even though the schema
 * keeps `servings` per dish. "Carne ×2, Arroz ×4" reads as a bug to almost
 * everybody; keeping the column per-dish means an override stays possible later
 * with no migration.
 */
export function SlotSheet({
  plan,
  entries,
  dayLabel,
  mealLabel,
  recipes,
  vocabulary,
  editable,
  listEditable,
  onAssign,
  onCreateRecipe,
  onAddToList,
  onResyncList,
  onRemove,
  onClose,
  currentUserId,
}: {
  plan: MealPlan | null;
  /** Every dish planned for this slot, oldest first. Empty opens the picker. */
  entries: PlanEntry[];
  dayLabel: string;
  mealLabel: string;
  recipes: Recipe[];
  /** So the "already on the list" annotation matches across languages too. */
  vocabulary: GroceryItem[];
  editable: boolean;
  listEditable: boolean;
  onAssign: (recipe: Recipe | null, name: string, servings: number) => Promise<PlanEntry | null>;
  /** Saves a dish invented here and returns it, or null if it did not save. */
  onCreateRecipe: (input: CreateRecipeInput) => Promise<Recipe | null>;
  onAddToList: (entry: PlanEntry, lines: ScaledLine[]) => Promise<void>;
  /** Replaces one dish's contribution to the list — see §4.5 on drift. */
  onResyncList: (entry: PlanEntry, lines: ScaledLine[]) => Promise<void>;
  onRemove: (entry: PlanEntry, dropFromList: boolean) => Promise<void>;
  onClose: () => void;
  /** For ordering the author chips — you come first in your own collection. */
  currentUserId: string | null;
}) {
  const { t, tp } = useI18n();
  const [step, setStep] = useState<Step>(entries.length > 0 ? "dishes" : "pick");
  // Same shape `/dashboard` holds, through the same component. Deliberately
  // *not* the same instance: the sheet is mounted per open, so it always starts
  // unnarrowed rather than inheriting chips tapped on another page.
  //
  // `q` does double duty here, as it always has — it narrows the list, and if you
  // assign without picking anything it becomes the name of a one-off entry.
  const [filters, setFilters] = useState<RecipeFilterState>(NO_FILTERS);
  const [picked, setPicked] = useState<Recipe | null>(null);
  // One headcount for the slot: the largest any dish in it is sized for, which
  // is the number of people actually eating.
  const [servings, setServings] = useState(entries.length > 0 ? Math.max(...entries.map((e) => e.servings)) : 2);
  const [busy, setBusy] = useState(false);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  // The entry this sheet is working with: the one passed in, or the one just
  // created. Held locally so the ingredient step works before the parent has
  // refetched.
  const [working, setWorking] = useState<PlanEntry | undefined>(undefined);
  // The headcount the list was built for, captured the first time it changes.
  // Held rather than derived: once the entries are rewritten, the old number is
  // gone, and that number is what "las cantidades de 2" is reporting.
  const [listBuiltFor, setListBuiltFor] = useState<number | null>(null);
  // The dish being invented, if any. Held here rather than in `CreateStep` so a
  // stray tap on the category grid cannot remount the ingredient box and lose
  // what you typed into it.
  const [draft, setDraft] = useState<{ title: string; type: FoodType; servings: number; touched: boolean }>(BLANK_DRAFT);
  const [rows, setRows] = useState<CaptureRow[]>([]);
  const nextRowId = useRef(0);
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

  // Re-read from the live list each render: removing a dish or changing the
  // headcount rewrites `entries`, and a held copy would go stale mid-sheet.
  const live = working ? entries.find((e) => e.id === working.id) : undefined;
  const recipeFor = live?.recipe_id ? recipes.find((r) => r.id === live.recipe_id) : undefined;
  const source = step === "pick" ? picked : (recipeFor ?? picked);

  const lines = useMemo(
    () => (source ? scaleIngredients(source.ingredients, live?.servings ?? servings) : []),
    [source, live?.servings, servings],
  );

  /** What the list already holds for a line, so the popup shows the running
   *  total *before* you decide rather than after (§4.6). */
  const alreadyOnList = (line: ScaledLine): string | null => {
    const existing = findExistingLine(plan?.items ?? [], line, resolveKey(line.name, aliases));
    if (!existing) return null;
    // A line already there with no quantity still deserves saying so — "sal" is
    // on the list even though the list cannot say how much.
    return formatAmount(existing.total_amount, existing.unit) ?? "✓";
  };

  const shown = useMemo(() => filterRecipes(recipes, filters), [recipes, filters]);
  const aliases = useMemo(() => byKey(vocabulary), [vocabulary]);

  const assign = async () => {
    if (!picked && !filters.q.trim()) return;
    setBusy(true);
    try {
      const saved = await onAssign(picked, picked?.title ?? filters.q.trim(), servings);
      if (saved) {
        setWorking(saved);
        setUnticked(new Set());
        // Straight into its ingredients: you just chose a dish, and the amounts
        // it puts on the list are the next thing you care about.
        setStep("ingredients");
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * Start inventing a dish, seeded with whatever you searched for.
   *
   * `guarnicion` is the default because that is the category you reach this
   * screen from: a `comida` you plan is almost always one you already wrote
   * down, while `Arroz blanco` is the thing you only notice is missing at the
   * moment you need it (§5.3).
   */
  const openCreate = () => {
    setDraft({ title: filters.q.trim(), type: "guarnicion", servings: 1, touched: false });
    setRows([]);
    nextRowId.current = 0;
    setStep("create");
  };

  const chooseType = (type: FoodType) => {
    // The basis follows the category until you overrule it: a guarnición is
    // written per person and scaled by the slot (§5.4), while anything else is
    // written for the table you are planning for right now.
    setDraft((prev) => ({ ...prev, type, servings: prev.touched ? prev.servings : type === "guarnicion" ? 1 : servings }));
  };

  const items = rows
    .map((row) => ({ name: row.name.trim(), amount: row.amount.trim() ? Number(row.amount) : undefined, unit: row.unit.trim() || undefined }))
    .filter((item) => item.name.length > 0);
  const creatable = draft.title.trim().length > 0 && items.length > 0;

  const createAndAssign = async () => {
    if (!creatable) return;
    setBusy(true);
    try {
      const created = await onCreateRecipe({
        title: draft.title.trim(),
        // No method, on purpose — ADR-0007's whole point is that a dish is a
        // recipe without one, and stopping to write "boil the rice" is the
        // friction this screen exists to remove. It graduates later.
        instructions: null,
        food_type: draft.type,
        ingredients: { servings: draft.servings, items },
      });
      if (!created) return;
      // Picked as well as assigned: the ingredient step reads amounts off
      // `recipes`, and the parent has not necessarily folded the new dish into
      // that list by the time this renders.
      setPicked(created);
      const saved = await onAssign(created, created.title, servings);
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
    if (!live) return;
    setBusy(true);
    try {
      await onAddToList(live, lines.filter((l) => !unticked.has(l.id)));
      // Back to the slot, not out of it. With several dishes in a slot the next
      // thing you almost always want is the *other* one's ingredients, and
      // closing would make you reopen the same slot to get there.
      setWorking(undefined);
      setStep("dishes");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (dropFromList: boolean) => {
    if (!live) return;
    setBusy(true);
    try {
      await onRemove(live, dropFromList);
      // Emptying the slot leaves nothing to come back to, so that closes.
      if (entries.length > 1) {
        setWorking(undefined);
        setStep("dishes");
      } else {
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * Apply one headcount to every dish in the slot.
   *
   * One request per dish rather than a bulk route: `PUT /plans/entries` is keyed
   * on the dish within the slot, so this is exactly the call it already makes,
   * and a slot holds two or three dishes. A bulk endpoint would be a new route,
   * a new schema and a new gateway entry to save one round trip nobody waits on.
   */
  const applyServings = async (next: number) => {
    const previous = servings;
    setServings(next);
    if (entries.length === 0) return;
    setBusy(true);
    try {
      for (const each of entries) {
        if (each.servings === next) continue;
        await onAssign(recipes.find((r) => r.id === each.recipe_id) ?? null, each.dish_name, next);
      }
      // Only once, and only if something is actually on the list. Stepping from
      // 2 to 7 is five taps; asking on each of them would be five dialogs for
      // one decision, which is why this is a banner that waits rather than a
      // modal that interrupts.
      if (listBuiltFor === null && entries.some((each) => listedFor(each) > 0)) setListBuiltFor(previous);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Rebuild every dish's lines at the new headcount, after the user says yes.
   *
   * Recomputed from each dish's own recipe rather than scaled from what is on
   * the list: the list holds a *merged* total that other dishes and hand-added
   * extras contribute to, so multiplying it would inflate their share too. The
   * server subtracts exactly this dish's old contribution and adds the new one.
   */
  const resyncList = async () => {
    setBusy(true);
    try {
      for (const each of entries) {
        if (listedFor(each) === 0) continue;
        const recipe = recipes.find((r) => r.id === each.recipe_id);
        if (!recipe) continue;
        await onResyncList(each, scaleIngredients(recipe.ingredients, each.servings));
      }
      setListBuiltFor(null);
    } finally {
      setBusy(false);
    }
  };

  const listedFor = (candidate: PlanEntry): number => linesFromEntry(plan?.items ?? [], candidate).length;
  const listedCount = live ? listedFor(live) : 0;

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
              {step === "pick"
                ? t("plan.choose-dish")
                : step === "create"
                  ? t("plan.create-dish")
                  : step === "dishes"
                    ? mealLabel
                    : (live?.dish_name ?? mealLabel)}
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
          {step === "dishes" && (
            <DishesStep
              entries={entries}
              editable={editable}
              servings={servings}
              onServingsChange={applyServings}
              busy={busy}
              listedFor={listedFor}
              listBuiltFor={listBuiltFor}
              onResync={resyncList}
              onDismissResync={() => setListBuiltFor(null)}
              onOpen={(chosen) => {
                setWorking(chosen);
                setUnticked(new Set());
                setStep("ingredients");
              }}
              onRemove={(chosen) => {
                setWorking(chosen);
                setStep("confirm-remove");
              }}
            />
          )}

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
              onCreate={openCreate}
            />
          )}

          {step === "create" && (
            <CreateStep
              draft={draft}
              onTitleChange={(title) => setDraft((prev) => ({ ...prev, title }))}
              onTypeChange={chooseType}
              onServingsChange={(next) => setDraft((prev) => ({ ...prev, servings: next, touched: true }))}
              rows={rows}
              onRowsChange={setRows}
              nextId={() => nextRowId.current++}
              slotServings={servings}
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

          {step === "confirm-remove" && live && (
            <div className="space-y-3">
              <p className="text-fg">
                {t("plan.remove-recipe-confirm", { recipe: live.dish_name, day: `${dayLabel} · ${mealLabel}` })}
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
          {/* Two exits, and **"Listo" is the primary one**. The ✕ in the header
              is the only way out of this step otherwise, and on a sheet that
              just saved three things a close cross reads as "discard" — you
              hesitate over it, which is exactly the wrong feeling at the end of
              a task that succeeded. Adding a dish is the *optional* extra here:
              this step is only ever reached with a dish already in the slot, so
              the completion action is what deserves the weight. */}
          {step === "dishes" && (
            <>
              {editable && (
                <button
                  type="button"
                  onClick={() => {
                    setPicked(null);
                    setFilters(NO_FILTERS);
                    setStep("pick");
                  }}
                  className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border border-line px-4 py-3 font-display text-sm font-semibold text-fg transition-colors hover:border-tomato/50 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                >
                  <Plus className="h-4 w-4" />
                  {t("plan.add-dish")}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-tomato px-4 py-3 font-display text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
              >
                <Check className="h-4 w-4" />
                {t("common.done")}
              </button>
            </>
          )}

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

          {step === "create" && (
            <>
              <button
                type="button"
                onClick={() => setStep("pick")}
                className="cursor-pointer rounded-full border border-line px-4 py-3 text-sm font-semibold text-fg transition-colors hover:border-tomato/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
              >
                {t("common.back")}
              </button>
              <button
                type="button"
                onClick={createAndAssign}
                disabled={busy || !creatable}
                className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-tomato px-4 py-3 font-display text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
              >
                <Check className="h-4 w-4" />
                {t("plan.create-and-add")}
              </button>
            </>
          )}

          {step === "ingredients" && live && (
            <>
              {/* Back to the slot rather than out of the sheet: with several
                  dishes in one slot, "done with this one" and "done with the
                  whole meal" are different intentions. */}
              <button
                type="button"
                onClick={() => {
                  setWorking(undefined);
                  setStep("dishes");
                }}
                className="cursor-pointer rounded-full border border-line px-4 py-3 text-sm font-semibold text-fg transition-colors hover:border-tomato/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
              >
                {t("common.back")}
              </button>
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
              onClick={() => setStep(working ? "ingredients" : "dishes")}
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

/**
 * What is planned for this meal, as a flat list.
 *
 * No main and no side: they are equal rows, ordered by when they were added.
 * "Ensalada con pollo" has no answer to which one is the accompaniment, and
 * nothing in the app would behave differently if it did.
 *
 * One headcount at the top for the whole slot. It writes through to every dish
 * (see `applyServings`), so the per-dish column the schema keeps stays an
 * override nobody has asked for yet rather than a number you have to set twice.
 */
function DishesStep({
  entries,
  editable,
  servings,
  onServingsChange,
  busy,
  listedFor,
  listBuiltFor,
  onResync,
  onDismissResync,
  onOpen,
  onRemove,
}: {
  entries: PlanEntry[];
  editable: boolean;
  servings: number;
  onServingsChange: (next: number) => void;
  busy: boolean;
  listedFor: (entry: PlanEntry) => number;
  /** The headcount the list still holds, or null when it is up to date. */
  listBuiltFor: number | null;
  onResync: () => void;
  onDismissResync: () => void;
  onOpen: (entry: PlanEntry) => void;
  onRemove: (entry: PlanEntry) => void;
}) {
  const { t, tp } = useI18n();
  const stale = listBuiltFor !== null && listBuiltFor !== servings;
  const staleLines = entries.reduce((total, entry) => total + listedFor(entry), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Users className="h-4 w-4 text-muted" aria-hidden />
          {t("plan.slot-servings")}
        </span>
        <span className="flex items-center gap-2">
          <Stepper
            label="−"
            onClick={() => onServingsChange(Math.max(1, servings - 1))}
            disabled={!editable || busy || servings <= 1}
            icon={<Minus className="h-4 w-4" />}
          />
          <span className="w-9 text-center font-display text-lg font-bold tabular-nums text-fg">{servings}</span>
          <Stepper
            label="+"
            onClick={() => onServingsChange(Math.min(99, servings + 1))}
            disabled={!editable || busy || servings >= 99}
            icon={<Plus className="h-4 w-4" />}
          />
        </span>
      </div>

      {/* **A banner, not a dialog.** Stepping 2 → 7 is five taps and one
          decision; a confirm on each would be five dialogs. It also obeys §4.5
          literally — the list does not rewrite itself, it waits to be told —
          and waiting costs nothing, because the amounts only matter at the shop.
          "Dejarlas" is a real answer, not a dismissal: you may have already
          bought for two and only need the extra by hand. */}
      {stale && (
        <div className="rounded-2xl border border-amber/40 bg-amber/10 px-4 py-3">
          <p className="text-sm font-semibold text-fg">{tp("plan.list-stale", listBuiltFor ?? 0)}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onResync}
              disabled={busy}
              className="cursor-pointer rounded-full bg-tomato px-4 py-2 font-display text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
            >
              {busy ? t("common.working") : tp("plan.update-list", staleLines)}
            </button>
            <button
              type="button"
              onClick={onDismissResync}
              disabled={busy}
              className="cursor-pointer rounded-full border border-line px-4 py-2 text-sm font-semibold text-fg transition-colors hover:border-tomato/40 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
            >
              {t("plan.leave-list")}
            </button>
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 px-1 font-display text-[0.7rem] font-bold uppercase tracking-wider text-muted">{t("plan.dishes-in-slot")}</h3>
        <ul className="space-y-2">
          {entries.map((entry) => {
            const listed = listedFor(entry);
            return (
              <li key={entry.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpen(entry)}
                  className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 rounded-2xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-tomato/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                >
                  <span className="w-full text-sm font-semibold text-fg [overflow-wrap:anywhere]">{entry.dish_name}</span>
                  <span className={`text-xs ${listed > 0 ? "text-leaf-700 dark:text-leaf" : "text-muted"}`}>
                    {listed > 0 ? `${t("plan.dish-on-list")} · ${listed}` : t("plan.dish-not-on-list")}
                  </span>
                </button>
                {editable && (
                  <button
                    type="button"
                    onClick={() => onRemove(entry)}
                    aria-label={`${t("plan.remove-recipe")}: ${entry.dish_name}`}
                    className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-tomato/15 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {/* The headcount is the slot's, so it is stated once here rather than on
            every row — repeating "para 4" three times is noise, not detail. */}
        <p className="mt-2 px-1 text-xs text-muted">{tp("plan.for-people", servings)}</p>
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
  onCreate,
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
  onCreate: () => void;
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

      {/* At the bottom, and not competing with the list: you look for this only
          after failing to find something, and a search that matches nothing puts
          it directly under "nothing matches that".

          It is deliberately a *different* offer from the footer's "add to the
          week", which takes the same typed text and makes a one-off entry —
          right for a Tuesday you are not cooking, and the reason `arroz` ends up
          contributing nothing to the shopping list (§5.3). Naming the query in
          the label is what separates them at a glance. */}
      <button
        type="button"
        onClick={onCreate}
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-line px-4 py-3 text-sm font-semibold text-muted transition-colors hover:border-tomato/50 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
      >
        <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
        {filters.q.trim() ? t("plan.create-named", { name: filters.q.trim() }) : t("plan.create-dish")}
      </button>
    </div>
  );
}

/**
 * Invent a dish without leaving the week (§5.3).
 *
 * Four fields, and three of them have a defensible default — which is the point.
 * Fifteen seconds, once, and `Arroz blanco` exists forever with ingredients that
 * reach the shopping list. The alternative people actually take is typing
 * `arroz` as free text, which is faster every single time and never buys any
 * rice.
 *
 * **The ingredient box is §4's, reused verbatim.** Including its fallback: when
 * no provider answers, the lines come back as raw rows you edit by hand, so this
 * screen keeps working with the model down. What it does *not* offer is
 * instructions — ADR-0007 already says a dish is a recipe without them, and
 * asking here would rebuild the friction this exists to remove.
 */
function CreateStep({
  draft,
  onTitleChange,
  onTypeChange,
  onServingsChange,
  rows,
  onRowsChange,
  nextId,
  slotServings,
}: {
  draft: { title: string; type: FoodType; servings: number };
  onTitleChange: (next: string) => void;
  onTypeChange: (next: FoodType) => void;
  onServingsChange: (next: number) => void;
  rows: CaptureRow[];
  onRowsChange: (next: CaptureRow[]) => void;
  nextId: () => number;
  /** How many people this meal is for — what the amounts below get scaled to. */
  slotServings: number;
}) {
  const { t, tp } = useI18n();

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="new-dish-title" className="mb-1.5 block text-sm font-semibold text-fg">
          {t("recipe-form.title")} {t("common.required-marker")}
        </label>
        <input
          id="new-dish-title"
          type="text"
          value={draft.title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder={t("plan.create-title-placeholder")}
          className="h-11 w-full rounded-2xl border border-line bg-surface px-4 text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30"
        />
      </div>

      <div>
        <span className="mb-1.5 block text-sm font-semibold text-fg">{t("recipe-form.type")}</span>
        <FoodTypePicker value={draft.type} onChange={onTypeChange} />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Users className="h-4 w-4 text-muted" aria-hidden />
            {t("plan.amounts-for")}
          </span>
          <span className="flex items-center gap-1">
            <Stepper
              label="−"
              onClick={() => onServingsChange(Math.max(1, draft.servings - 1))}
              disabled={draft.servings <= 1}
              icon={<Minus className="h-4 w-4" />}
            />
            <span className="w-9 text-center font-display text-lg font-bold tabular-nums text-fg">{draft.servings}</span>
            <Stepper
              label="+"
              onClick={() => onServingsChange(Math.min(99, draft.servings + 1))}
              disabled={draft.servings >= 99}
              icon={<Plus className="h-4 w-4" />}
            />
          </span>
        </div>
        {/* Says out loud what ADR-0001 does silently, because "80 g of rice" for
            a meal for four looks like a mistake until you know it gets
            multiplied. This is what removes the "it feels weird to ask a
            quantity for rice" problem — not the wording of the label. */}
        <p className="text-xs text-muted">{tp("plan.scales-to", slotServings)}</p>
      </div>

      <div>
        <span className="mb-1.5 block text-sm font-semibold text-fg">
          {t("recipe-form.ingredients")} {t("common.required-marker")}
        </span>
        <IngredientCapture rows={rows} onRowsChange={onRowsChange} servings={draft.servings} nextId={nextId} />
        {rows.length === 0 && <p className="mt-1.5 text-xs text-muted">{t("plan.structure-first")}</p>}
      </div>
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
          {t("plan.dish-on-list")} · {listedCount}
        </p>
      )}
    </div>
  );
}
