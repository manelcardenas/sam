import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WeekGrid } from "./WeekGrid";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import type { MealPlan, PlanEntry, ShoppingListItem } from "@/lib/api-client";

/**
 * The week, with slots that hold **more than one dish**
 * (docs/plans/ingredient-capture-plan.md §5).
 *
 * Two things here lose real information when wrong: a slot silently showing one
 * of its dishes, and the basket badge reading a half-added slot as a finished
 * one — which is the version that sends you to the shop without the rice.
 */

const SATURDAY = "2026-09-12";

function entry(id: string, dish_name: string, extra: Partial<PlanEntry> = {}): PlanEntry {
  return { id, date: SATURDAY, meal: "dinner", recipe_id: null, dish_name, servings: 2, created_by: null, created_by_name: null, ...extra };
}

function item(dishName: string, entryId: string): ShoppingListItem {
  return {
    id: `item-${entryId}`,
    display_name: "cebolla",
    normalised_name: "cebolla",
    grocery_key: null,
    unit: null,
    total_amount: 1,
    is_checked: false,
    is_manual: false,
    pending_since: null,
    sources: [{ entry_id: entryId, dish_name: dishName, amount: 1 }],
    created_by: null,
    created_by_name: null,
  };
}

function setup(entries: PlanEntry[], items: ShoppingListItem[] = []) {
  const plan: MealPlan = {
    id: "plan-1",
    kitchen_id: "k1",
    week_start: SATURDAY,
    status: "planning",
    entries,
    items,
    created_by: null,
    created_at: "",
    updated_at: "",
  };
  const onOpenSlot = vi.fn();
  render(
    <LocaleProvider>
      <WeekGrid weekStart={SATURDAY} plan={plan} today={SATURDAY} editable onOpenSlot={onOpenSlot} currentUserId={null} />
    </LocaleProvider>,
  );
  return { onOpenSlot };
}

/** The dinner slot of the first day, whatever it currently renders as. */
function dinnerSlot(): HTMLElement {
  return screen.getAllByRole("button").find((b) => /dinner/i.test(b.getAttribute("aria-label") ?? ""))!;
}

describe("a slot holding several dishes", () => {
  it("shows every dish, not just the first", () => {
    setup([entry("a", "Carne en salsa"), entry("b", "Arroz blanco")]);

    expect(within(dinnerSlot()).getByText("Carne en salsa")).toBeInTheDocument();
    expect(within(dinnerSlot()).getByText("Arroz blanco")).toBeInTheDocument();
  });

  it("names all of them to a screen reader", () => {
    setup([entry("a", "Carne en salsa"), entry("b", "Arroz blanco")]);

    expect(dinnerSlot().getAttribute("aria-label")).toContain("Carne en salsa");
    expect(dinnerSlot().getAttribute("aria-label")).toContain("Arroz blanco");
  });

  it("summarises past three rather than growing the card", () => {
    setup(["a", "b", "c", "d", "e"].map((id, i) => entry(id, `Plato ${i}`)));

    expect(within(dinnerSlot()).getByText("+2 more")).toBeInTheDocument();
    expect(within(dinnerSlot()).queryByText("Plato 4")).not.toBeInTheDocument();
  });

  it("shows the largest headcount, because that is who is eating", () => {
    // Rice for four and meat for two is one dinner for four.
    setup([entry("a", "Carne en salsa", { servings: 2 }), entry("b", "Arroz blanco", { servings: 4 })]);

    expect(within(dinnerSlot()).getByText(/4 people/)).toBeInTheDocument();
  });

  it("still opens the slot when tapped", () => {
    const { onOpenSlot } = setup([entry("a", "Carne en salsa")]);

    fireEvent.click(dinnerSlot());

    expect(onOpenSlot).toHaveBeenCalledWith(SATURDAY, "dinner");
  });
});

describe("the shopping-list badge", () => {
  it("says nothing has been added when nothing has", () => {
    setup([entry("a", "Carne en salsa"), entry("b", "Arroz blanco")]);

    expect(within(dinnerSlot()).getByText("Not added yet")).toBeInTheDocument();
  });

  it("distinguishes a half-added slot from a finished one", () => {
    // The failure this exists for: reading "some" as "all" is what sends you
    // home without the rice.
    setup([entry("a", "Carne en salsa"), entry("b", "Arroz blanco")], [item("Carne en salsa", "a")]);

    expect(within(dinnerSlot()).getByText("Only some dishes on the list")).toBeInTheDocument();
  });

  it("says so only once every dish has reached the list", () => {
    setup([entry("a", "Carne en salsa"), entry("b", "Arroz blanco")], [item("Carne en salsa", "a"), item("Arroz blanco", "b")]);

    expect(within(dinnerSlot()).getByText("On the list")).toBeInTheDocument();
  });
});
