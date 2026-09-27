"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Minus, Package, Plus, Search, Sparkles, StickyNote, Trash2, Users, X } from "lucide-react";
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

type Draft = { title: string; type: FoodType; servings: number; touched: boolean; readyMade: boolean };

/** A guarnición per person, which is what §5.4 says the default has to be. */
const BLANK_DRAFT: Draft = { title: "", type: "guarnicion", servings: 1, touched: false, readyMade: false };

/**
 * The one modal the planner has: everything you do to a slot happens here.
 *
 * **Choosing a dish and deciding what it puts on the list are one screen.** Tap
 * a recipe and its ingredients open under it, already ticked and scaled to the
 * meal; untick what you have and one button adds the dish *and* its shopping.
 * It used to be two steps — assign, then a second screen with "add to the
 * list" — and closing the sheet between them left a dish in the calendar with
 * nothing bought for it, which the week only admitted to through a small basket
 * icon (meal-planner-plan §8.14). "Only to the calendar" is still there, as the
 * quiet option, for the dish you already have everything for.
 *
 * **One headcount, at the top, for the whole slot.** The schema keeps
 * `servings` per dish, but "Carne ×2, Arroz ×4" reads as a bug to almost
 * everybody, so the number above the list writes through to every dish in the
 * slot — including one you are about to add. There used to be a second stepper
 * inside the picker, which is how the two numbers got to disagree.
 *
 * **What goes in a slot is what you eat at that meal.** Three ways to put
 * something there, each saying what it does to the list:
 *
 * - a recipe from the collection — its ingredients go to the list;
 * - a new dish, written here without leaving the week (§5.3) — the same, once
 *   it exists; "I buy it ready-made" makes the product itself the one
 *   ingredient, which is the salmorejo in a tub;
 * - a note with no recipe — "Comemos fuera", "Sobras" — which puts nothing on
 *   the list, and says so.
 *
 * Things you buy that are not a meal (bin bags, the week's yoghurts) are not a
 * slot's business at all: they go on the list directly, from the list.
 *
 * **A slot holds several dishes** (ingredient-capture-plan §5), so a filled slot
 * opens on its list rather than inside one dish. They are equal — no main and no
 * side, because "ensalada con pollo" has no answer to which is which.
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
  preselect = null,
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
  /** A recipe chosen before the slot was — "plan this" from its own page. Opens the picker with it picked. */
  preselect?: Recipe | null;
  /**
   * Put a dish in the slot and, when `lines` are given, its shopping on the list
   * — in one call, so the list is written against the plan the assignment just
   * created rather than one captured before it existed.
   */
  onAssign: (recipe: Recipe | null, name: string, servings: number, lines?: ScaledLine[]) => Promise<PlanEntry | null>;
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
  const [step, setStep] = useState<Step>(preselect || entries.length === 0 ? "pick" : "dishes");
  // Same shape `/dashboard` holds, through the same component. Deliberately
  // *not* the same instance: the sheet is mounted per open, so it always starts
  // unnarrowed rather than inheriting chips tapped on another page. `q` also
  // names what the two "not in your collection" offers would create.
  const [filters, setFilters] = useState<RecipeFilterState>(NO_FILTERS);
  const [picked, setPicked] = useState<Recipe | null>(preselect);
  // One headcount for the slot: the largest any dish in it is sized for, which
  // is the number of people actually eating.
  const [servings, setServings] = useState(entries.length > 0 ? Math.max(...entries.map((e) => e.servings)) : 2);
  const [busy, setBusy] = useState(false);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  // The dish whose ingredients are open, when that is an existing one. Held
  // locally so the step works before the parent has refetched.
  const [working, setWorking] = useState<PlanEntry | undefined>(undefined);
  // The headcount the list was built for, captured the first time it changes.
  // Held rather than derived: once the entries are rewritten, the old number is
  // gone, and that number is what "las cantidades de 2" is reporting.
  const [listBuiltFor, setListBuiltFor] = useState<number | null>(null);
  // The dish being invented, if any. Held here rather than in `CreateStep` so a
  // stray tap on the category grid cannot remount the ingredient box and lose
  // what you typed into it.
  const [draft, setDraft] = useState<Draft>(BLANK_DRAFT);
  const [rows, setRows] = useState<CaptureRow[]>([]);
  const nextRowId = useRef(0);
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
  const source = step === "pick" ? picked : recipeFor;

  const lines = useMemo(
    () => (source ? scaleIngredients(source.ingredients, live?.servings ?? servings) : []),
    [source, live?.servings, servings],
  );
  const chosen = lines.filter((l) => !unticked.has(l.id));

  const aliases = useMemo(() => byKey(vocabulary), [vocabulary]);
  const shown = useMemo(() => filterRecipes(recipes, filters), [recipes, filters]);

  /** What the list already holds for a line, so the running total shows *before* you decide (§4.6). */
  const alreadyOnList = (line: ScaledLine): string | null => {
    const existing = findExistingLine(plan?.items ?? [], line, resolveKey(line.name, aliases));
    if (!existing) return null;
    // A line already there with no quantity still deserves saying so — "sal" is
    // on the list even though the list cannot say how much.
    return formatAmount(existing.total_amount, existing.unit) ?? "✓";
  };

  const toggleLine = (id: string) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const pick = (recipe: Recipe | null) => {
    setPicked(recipe);
    // Unticks belong to the recipe they were made on; carrying them to the next
    // one would untick its line 2 because the last one's line 2 was salt.
    setUnticked(new Set());
  };

  const backToDishes = () => {
    setWorking(undefined);
    setPicked(null);
    setStep("dishes");
  };

  /** The picked recipe into the slot — with its ticked ingredients on the list, or on its own. */
  const addPicked = async (withList: boolean) => {
    if (!picked) return;
    setBusy(true);
    try {
      const saved = await onAssign(picked, picked.title, servings, withList && listEditable ? chosen : undefined);
      if (saved) backToDishes();
    } finally {
      setBusy(false);
    }
  };

  /** A note in the slot, not a dish: "Comemos fuera" buys nothing. */
  const addNote = async () => {
    const name = filters.q.trim();
    if (!name) return;
    setBusy(true);
    try {
      if (await onAssign(null, name, servings)) backToDishes();
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
    setDraft({ ...BLANK_DRAFT, title: filters.q.trim() });
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

  const typed = rows
    .map((row) => ({ name: row.name.trim(), amount: row.amount.trim() ? Number(row.amount) : undefined, unit: row.unit.trim() || undefined }))
    .filter((item) => item.name.length > 0);
  // Ready-made, the thing you buy *is* the ingredient: one of it, for however
  // many people one of it feeds. Scaling does the rest — a tub for two is two
  // tubs for four.
  const items = draft.readyMade ? [{ name: draft.title.trim(), amount: 1, unit: undefined }] : typed;
  const creatable = draft.title.trim().length > 0 && items.length > 0;

  /**
   * Save the invented dish, then show it picked — ingredients open, ticked.
   *
   * Not straight into the slot: the list decision is the same one every other
   * dish gets, on the same screen, and a dish you just typed "sal" into is
   * exactly the one where unticking matters.
   */
  const create = async () => {
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
      // Held here as well as in the parent's `recipes`: the parent has not
      // necessarily folded the new dish into that list by the time this renders.
      pick(created);
      setFilters(NO_FILTERS);
      setStep("pick");
    } finally {
      setBusy(false);
    }
  };

  const addToList = async () => {
    if (!live) return;
    setBusy(true);
    try {
      await onAddToList(live, chosen);
      // Back to the slot, not out of it. With several dishes in a slot the next
      // thing you almost always want is the *other* one's ingredients.
      backToDishes();
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
      if (entries.length > 1) backToDishes();
      else onClose();
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
  const inSlot = new Set(entries.map((e) => e.recipe_id).filter((id): id is string => id !== null));

  const primary =
    "flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-tomato px-4 py-3 font-display text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50";
  const secondary =
    "cursor-pointer rounded-full border border-line px-4 py-3 text-sm font-semibold text-fg transition-colors hover:border-tomato/40 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50";

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
        // Bottom sheet on a phone, centred card on a desktop. The planner is
        // used one-handed in a kitchen and a supermarket, and the bottom of the
        // screen is the half of it a thumb reaches.
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-4xl border border-line bg-surface shadow-paw sm:rounded-4xl will-fetch animate-fetch-in"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className="text-[0.7rem] font-bold uppercase tracking-wider text-muted">
              {dayLabel} · {mealLabel}
            </p>
            <h2 className="font-display text-lg font-bold text-fg [overflow-wrap:anywhere]">
              {step === "pick"
                ? t("plan.choose-dish")
                : step === "create"
                  ? t("plan.create-dish")
                  : step === "dishes"
                    ? t("plan.dishes-in-slot")
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
          {(step === "dishes" || step === "pick") && (
            <ServingsBar servings={servings} onChange={applyServings} disabled={!editable || busy} />
          )}

          {step === "dishes" && (
            <DishesStep
              entries={entries}
              editable={editable}
              servings={servings}
              busy={busy}
              listedFor={listedFor}
              listBuiltFor={listBuiltFor}
              onResync={resyncList}
              onDismissResync={() => setListBuiltFor(null)}
              onOpen={(chosenEntry) => {
                setWorking(chosenEntry);
                setUnticked(new Set());
                setStep("ingredients");
              }}
              onRemove={(chosenEntry) => {
                setWorking(chosenEntry);
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
              onPick={pick}
              inSlot={inSlot}
              lines={lines}
              unticked={unticked}
              onToggle={toggleLine}
              alreadyOnList={alreadyOnList}
              listEditable={listEditable}
              onCreate={openCreate}
              onNote={addNote}
              busy={busy}
            />
          )}

          {step === "create" && (
            <CreateStep
              draft={draft}
              onTitleChange={(title) => setDraft((prev) => ({ ...prev, title }))}
              onTypeChange={chooseType}
              onServingsChange={(next) => setDraft((prev) => ({ ...prev, servings: next, touched: true }))}
              onReadyMadeChange={(readyMade) => setDraft((prev) => ({ ...prev, readyMade }))}
              rows={rows}
              onRowsChange={setRows}
              nextId={() => nextRowId.current++}
              slotServings={servings}
            />
          )}

          {step === "ingredients" && live && (
            <div className="space-y-3">
              {/* The way back to the recipe itself. The slot holds a snapshot of
                  its name; the method, if anybody wrote one, lives on its page. */}
              {recipeFor && (
                <Link
                  href={`/dashboard?recipe=${encodeURIComponent(recipeFor.id)}`}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-tomato-700 hover:underline dark:text-tomato"
                >
                  {t("plan.see-recipe")}
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              )}
              <IngredientChecklist lines={lines} unticked={unticked} onToggle={toggleLine} alreadyOnList={alreadyOnList} />
              {listedCount > 0 && (
                <p className="rounded-2xl bg-surface-2 px-4 py-2.5 text-xs text-muted">
                  {t("plan.dish-on-list")} · {listedCount}
                </p>
              )}
            </div>
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

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-5 py-4">
          {/* Two exits, and **"Listo" is the primary one**. On a sheet that just
              saved three things a close cross reads as "discard", which is the
              wrong feeling at the end of a task that succeeded. */}
          {step === "dishes" && (
            <>
              {editable && (
                <button
                  type="button"
                  onClick={() => {
                    pick(null);
                    setFilters(NO_FILTERS);
                    setStep("pick");
                  }}
                  className={`flex flex-1 items-center justify-center gap-2 ${secondary}`}
                >
                  <Plus className="h-4 w-4" />
                  {t("plan.add-dish")}
                </button>
              )}
              <button type="button" onClick={onClose} className={primary}>
                <Check className="h-4 w-4" />
                {t("common.done")}
              </button>
            </>
          )}

          {step === "pick" && (
            <>
              {entries.length > 0 && (
                <button type="button" onClick={backToDishes} className={secondary}>
                  {t("common.back")}
                </button>
              )}
              {/* The quiet way in, for the dish you already have everything for.
                  Only offered when there is a list decision to skip. */}
              {picked && listEditable && chosen.length > 0 && (
                <button type="button" onClick={() => addPicked(false)} disabled={busy} className={secondary}>
                  {t("plan.calendar-only")}
                </button>
              )}
              <button type="button" onClick={() => addPicked(true)} disabled={busy || !picked} className={primary}>
                <Check className="h-4 w-4" />
                {!picked
                  ? t("plan.pick-a-dish")
                  : listEditable && chosen.length > 0
                    ? tp("plan.add-with-list", chosen.length)
                    : t("plan.assign")}
              </button>
            </>
          )}

          {step === "create" && (
            <>
              <button type="button" onClick={() => setStep("pick")} className={secondary}>
                {t("common.back")}
              </button>
              <button type="button" onClick={create} disabled={busy || !creatable} className={primary}>
                <Check className="h-4 w-4" />
                {t("plan.create")}
              </button>
            </>
          )}

          {step === "ingredients" && live && (
            <>
              {/* Back to the slot rather than out of the sheet: with several
                  dishes in one slot, "done with this one" and "done with the
                  whole meal" are different intentions. */}
              <button type="button" onClick={backToDishes} className={secondary}>
                {t("common.back")}
              </button>
              <button type="button" onClick={addToList} disabled={busy || chosen.length === 0 || !listEditable} className={primary}>
                {tp("plan.add-lines-to-list", chosen.length)}
              </button>
            </>
          )}

          {step === "confirm-remove" && (
            <button type="button" onClick={() => setStep(working ? "ingredients" : "dishes")} className={`flex-1 ${secondary}`}>
              {t("common.cancel")}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

/**
 * How many people this meal is for — once, for the whole slot, above whatever
 * the sheet is showing. Changing it writes through to every dish already there
 * and sizes the one you are about to add.
 */
function ServingsBar({ servings, onChange, disabled }: { servings: number; onChange: (next: number) => void; disabled: boolean }) {
  const { t } = useI18n();
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-2.5">
      <span className="flex items-center gap-2 text-sm font-semibold text-fg">
        <Users className="h-4 w-4 text-muted" aria-hidden />
        {t("plan.how-many")}
      </span>
      <span className="flex items-center gap-2">
        <Stepper label="−" onClick={() => onChange(Math.max(1, servings - 1))} disabled={disabled || servings <= 1} icon={<Minus className="h-4 w-4" />} />
        <span className="w-8 text-center font-display text-lg font-bold tabular-nums text-fg">{servings}</span>
        <Stepper label="+" onClick={() => onChange(Math.min(99, servings + 1))} disabled={disabled || servings >= 99} icon={<Plus className="h-4 w-4" />} />
      </span>
    </div>
  );
}

/**
 * What is planned for this meal, as a flat list.
 *
 * No main and no side: they are equal rows, ordered by when they were added.
 * Each says whether its shopping is on the list, because that is the question
 * the week grid's basket icon raises and this is where it gets answered.
 */
function DishesStep({
  entries,
  editable,
  servings,
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
      {/* **A banner, not a dialog.** Stepping 2 → 7 is five taps and one
          decision; a confirm on each would be five dialogs. It also obeys §4.5
          literally — the list does not rewrite itself, it waits to be told.
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
                <span className={`flex items-center gap-1 text-xs ${listed > 0 ? "text-leaf-700 dark:text-leaf" : "text-muted"}`}>
                  {listed > 0 && <Check className="h-3 w-3" aria-hidden />}
                  {listed > 0 ? `${t("plan.dish-on-list")} · ${listed}` : entry.recipe_id ? t("plan.dish-not-on-list") : t("plan.note-nothing-to-buy")}
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
  inSlot,
  lines,
  unticked,
  onToggle,
  alreadyOnList,
  listEditable,
  onCreate,
  onNote,
  busy,
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
  /** Recipes already in this slot — picking one again would only change its headcount. */
  inSlot: Set<string>;
  /** The picked recipe's ingredients, scaled to the slot. */
  lines: ScaledLine[];
  unticked: Set<string>;
  onToggle: (id: string) => void;
  alreadyOnList: (line: ScaledLine) => string | null;
  listEditable: boolean;
  onCreate: () => void;
  onNote: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const query = filters.q.trim();
  // A dish invented a moment ago is picked before the parent's list holds it,
  // so it is shown on its own at the top rather than missing from the list.
  const pickedOutsideList = picked && !recipes.some((r) => r.id === picked.id) ? [picked] : [];

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
          renders nothing when the collection is too small to distinguish. */}
      <div className="rail-scroll -mx-5 flex flex-nowrap items-center gap-2 overflow-x-auto px-5 empty:hidden">
        <RecipeFilterChips recipes={all} state={filters} onChange={onFiltersChange} currentUserId={currentUserId} />
      </div>

      {total === 0 && pickedOutsideList.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{t("plan.no-recipes-at-all")}</p>
      ) : recipes.length === 0 && pickedOutsideList.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{t("plan.no-matches")}</p>
      ) : (
        <ul className="space-y-1.5">
          {[...pickedOutsideList, ...recipes].map((recipe) => {
            const on = picked?.id === recipe.id;
            const already = inSlot.has(recipe.id);
            return (
              <li
                key={recipe.id}
                className={`overflow-hidden rounded-2xl border transition-colors ${on ? "border-tomato bg-tomato/5" : "border-line hover:border-tomato/40"}`}
              >
                <button
                  type="button"
                  onClick={() => onPick(on ? null : recipe)}
                  aria-pressed={on}
                  disabled={already}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-tomato/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-fg">{recipe.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {already
                        ? t("plan.already-in-slot")
                        : recipe.ingredients.items.length > 0
                          ? recipe.ingredients.items.map((i) => i.name).slice(0, 3).join(" · ")
                          : t("plan.no-ingredients")}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-tomato bg-tomato text-white" : "border-line"}`}
                  >
                    {on && <Check className="h-3.5 w-3.5" />}
                  </span>
                </button>
                {/* Open under the row you chose, not on a second screen: which
                    recipe and what it costs you at the shop are one decision. */}
                {on && listEditable && lines.length > 0 && (
                  <div className="border-t border-tomato/20 px-3 pb-3 pt-2.5">
                    <p className="mb-1.5 px-1 text-xs text-muted">{t("plan.ingredients-body")}</p>
                    <IngredientChecklist lines={lines} unticked={unticked} onToggle={onToggle} alreadyOnList={alreadyOnList} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Not in the collection. Two offers, because they are two different
          things and each says what it does to the list: a dish you are about to
          write down (its ingredients get bought), or a note on the calendar that
          buys nothing. Naming the search in both is what tells them apart. */}
      <div className="space-y-2 border-t border-line pt-4">
        <button
          type="button"
          onClick={onCreate}
          className="flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-line px-4 py-3 text-left transition-colors hover:border-tomato/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
        >
          <Sparkles className="h-4 w-4 shrink-0 text-tomato" aria-hidden />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-fg [overflow-wrap:anywhere]">
              {query ? t("plan.create-named", { name: query }) : t("plan.create-dish")}
            </span>
            <span className="block text-xs text-muted">{t("plan.create-hint")}</span>
          </span>
        </button>
        {query && (
          <button
            type="button"
            onClick={onNote}
            disabled={busy}
            className="flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-line px-4 py-3 text-left transition-colors hover:border-tomato/50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            <StickyNote className="h-4 w-4 shrink-0 text-muted" aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-fg [overflow-wrap:anywhere]">{t("plan.note-named", { name: query })}</span>
              <span className="block text-xs text-muted">{t("plan.note-hint")}</span>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Invent a dish without leaving the week (§5.3).
 *
 * Four fields, and three of them have a defensible default. **"I buy it
 * ready-made"** is the fifth, and it removes the fourth: a tub of salmorejo has
 * no ingredients but itself, so the product becomes the one line and the only
 * question left is how many people one of it feeds.
 *
 * **The ingredient box is §4's, reused verbatim.** Including its fallback: when
 * no provider answers, the lines come back as raw rows you edit by hand, so this
 * screen keeps working with the model down. What it does *not* offer is
 * instructions — ADR-0007 already says a dish is a recipe without them.
 */
function CreateStep({
  draft,
  onTitleChange,
  onTypeChange,
  onServingsChange,
  onReadyMadeChange,
  rows,
  onRowsChange,
  nextId,
  slotServings,
}: {
  draft: Draft;
  onTitleChange: (next: string) => void;
  onTypeChange: (next: FoodType) => void;
  onServingsChange: (next: number) => void;
  onReadyMadeChange: (next: boolean) => void;
  rows: CaptureRow[];
  onRowsChange: (next: CaptureRow[]) => void;
  nextId: () => number;
  /** How many people this meal is for — what the amounts below get scaled to. */
  slotServings: number;
}) {
  const { t, tp } = useI18n();
  const packs = Math.round((slotServings / Math.max(1, draft.servings)) * 10) / 10;

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
          placeholder={t(draft.readyMade ? "plan.ready-made-placeholder" : "plan.create-title-placeholder")}
          className="h-11 w-full rounded-2xl border border-line bg-surface px-4 text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30"
        />
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3">
        <input
          type="checkbox"
          checked={draft.readyMade}
          onChange={(e) => onReadyMadeChange(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-tomato"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-fg">
            <Package className="h-4 w-4 text-muted" aria-hidden />
            {t("plan.ready-made")}
          </span>
          <span className="block text-xs text-muted">{t("plan.ready-made-hint")}</span>
        </span>
      </label>

      <div>
        <span className="mb-1.5 block text-sm font-semibold text-fg">{t("recipe-form.type")}</span>
        <FoodTypePicker value={draft.type} onChange={onTypeChange} />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Users className="h-4 w-4 text-muted" aria-hidden />
            {t(draft.readyMade ? "plan.one-pack-feeds" : "plan.amounts-for")}
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
            multiplied — and "one tub" for four needs the same sentence. */}
        <p className="text-xs text-muted">
          {draft.readyMade ? t("plan.packs-for-meal", { count: String(packs), people: String(slotServings) }) : tp("plan.scales-to", slotServings)}
        </p>
      </div>

      {!draft.readyMade && (
        <div>
          <span className="mb-1.5 block text-sm font-semibold text-fg">
            {t("recipe-form.ingredients")} {t("common.required-marker")}
          </span>
          <IngredientCapture rows={rows} onRowsChange={onRowsChange} servings={draft.servings} nextId={nextId} />
          {rows.length === 0 && <p className="mt-1.5 text-xs text-muted">{t("plan.structure-first")}</p>}
        </div>
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

/**
 * A dish's ingredients as a checklist, **ticked by default**: the question is
 * what you already have, and that is usually the shorter answer.
 */
function IngredientChecklist({
  lines,
  unticked,
  onToggle,
  alreadyOnList,
}: {
  lines: ScaledLine[];
  unticked: Set<string>;
  onToggle: (id: string) => void;
  alreadyOnList: (line: ScaledLine) => string | null;
}) {
  const { t } = useI18n();

  if (lines.length === 0) {
    return <p className="py-4 text-center text-sm text-muted">{t("plan.no-ingredients")}</p>;
  }

  return (
    <ul className="space-y-0.5">
      {lines.map((line) => {
        const on = !unticked.has(line.id);
        const existing = alreadyOnList(line);
        return (
          <li key={line.id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-surface-2">
              <input type="checkbox" checked={on} onChange={() => onToggle(line.id)} className="h-5 w-5 shrink-0 cursor-pointer accent-tomato" />
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
  );
}
