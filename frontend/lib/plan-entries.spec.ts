import { describe, expect, it } from "vitest";

import { entryForDish } from "./plan-entries";
import type { PlanEntry } from "@/lib/api-client";

/**
 * The bug this exists to stop: a slot holds several dishes, so "the entry in
 * this slot" stopped being a question with one answer. Getting it wrong sends
 * you to the wrong dish's ingredients — silently, and only ever for the second
 * dish you add, which is the case nobody clicks through by hand.
 */

const SLOT = { date: "2026-09-15", meal: "dinner" as const };

function entry(id: string, dish_name: string, recipe_id: string | null, extra: Partial<PlanEntry> = {}): PlanEntry {
  return { id, date: SLOT.date, meal: "dinner", recipe_id, dish_name, servings: 2, created_by: null, created_by_name: null, ...extra };
}

describe("entryForDish", () => {
  it("finds the dish just added, not the one already there", () => {
    const entries = [entry("a", "Carne en salsa", "r-carne"), entry("b", "Arroz blanco", "r-arroz")];

    expect(entryForDish(entries, SLOT, "r-arroz", "Arroz blanco")?.id).toBe("b");
  });

  it("matches a one-off text entry by name, since it has no recipe to match on", () => {
    const entries = [entry("a", "Carne en salsa", "r-carne"), entry("b", "Sobras", null)];

    expect(entryForDish(entries, SLOT, null, "Sobras")?.id).toBe("b");
  });

  it("will not pass a recipe off as the text entry of the same name", () => {
    // `upsert_entry` treats these as two different dishes, so this must too —
    // otherwise adding "Arroz blanco" as free text would return the recipe and
    // the sheet would offer to shop for it.
    const entries = [entry("a", "Arroz blanco", "r-arroz")];

    expect(entryForDish(entries, SLOT, null, "Arroz blanco")).toBeNull();
  });

  it("ignores the same dish in another slot", () => {
    const entries = [entry("a", "Arroz blanco", "r-arroz", { meal: "lunch" })];

    expect(entryForDish(entries, SLOT, "r-arroz", "Arroz blanco")).toBeNull();
  });

  it("answers null when the save produced nothing matching", () => {
    expect(entryForDish([], SLOT, "r-arroz", "Arroz blanco")).toBeNull();
  });
});
