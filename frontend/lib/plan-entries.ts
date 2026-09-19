import type { Meal, PlanEntry } from "@/lib/api-client";

/**
 * Which entry a just-saved assignment produced.
 *
 * Every planner mutation answers with the whole plan rather than the row it
 * touched, so the caller has to find its own dish again. While a slot held one
 * dish that was a `.find` on `(date, meal)` and could not be wrong. **A slot
 * holds a flat list now** (docs/plans/ingredient-capture-plan.md §5), and that
 * `.find` quietly became "whichever dish is first" — add arroz to a slot that
 * already holds carne and the sheet would open the meat's ingredients.
 *
 * The rule mirrors `upsert_entry`'s exactly, and has to: the recipe id is the
 * identity, falling back to the name for one-off text entries, because
 * `uq_plan_entries_slot_dish` is partial on `recipe_id IS NOT NULL` and so
 * cannot speak for two entries called "Sobras". Two spellings of the same rule
 * is a frontend that disagrees with the database about which dish you just
 * added.
 */
export function entryForDish(
  entries: PlanEntry[],
  slot: { date: string; meal: Meal },
  recipeId: string | null,
  dishName: string,
): PlanEntry | null {
  return (
    entries.find(
      (entry) =>
        entry.date === slot.date &&
        entry.meal === slot.meal &&
        (recipeId ? entry.recipe_id === recipeId : entry.recipe_id === null && entry.dish_name === dishName),
    ) ?? null
  );
}
