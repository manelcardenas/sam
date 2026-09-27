import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RecipePlanRow } from "./RecipePlanRow";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import type { MealPlan, PlanEntry, Recipe } from "@/lib/api-client";

/**
 * The recipe page's way into the week and the week's way back (meal-planner-plan
 * §8.14). What is pinned is where each link goes: "plan it" carries the recipe
 * across to be placed, and each "this week" chip opens the meal it is in.
 */

const LENTEJAS = {
  id: "r-len",
  title: "Lentejas",
  instructions: null,
  ingredients: { servings: 2, items: [] },
  food_type: "comida",
  created_at: "",
  updated_at: "",
  created_by: null,
  created_by_name: null,
} as unknown as Recipe;

function entry(id: string, date: string, meal: "lunch" | "dinner", recipe_id: string | null): PlanEntry {
  return { id, date, meal, recipe_id, dish_name: "Lentejas", servings: 2, created_by: null, created_by_name: null };
}

function week(entries: PlanEntry[]): MealPlan {
  return { id: "p1", kitchen_id: "k1", week_start: "2026-09-05", status: "planning", entries, items: [], created_by: null, created_at: "", updated_at: "" };
}

function setup(plan: MealPlan | null) {
  render(
    <LocaleProvider>
      <RecipePlanRow recipe={LENTEJAS} week={plan} />
    </LocaleProvider>,
  );
}

describe("a recipe's way into the week", () => {
  it("carries the recipe to the planner to be placed", () => {
    setup(null);

    expect(screen.getByRole("link", { name: "Plan it" })).toHaveAttribute("href", "/plan?place=r-len");
  });

  it("says when it is already on this week's menu, each one a link to that meal", () => {
    setup(week([entry("e1", "2026-09-10", "dinner", "r-len"), entry("e2", "2026-09-11", "lunch", "other")]));

    const chips = screen.getAllByRole("link", { name: /this week/i });
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveAttribute("href", "/plan?slot=2026-09-10%3Adinner");
  });
});
