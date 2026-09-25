import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ShoppingList } from "./ShoppingList";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import type { GroceryItem, MealPlan, ShoppingListItem } from "@/lib/api-client";

/**
 * Filing a line in an aisle (ingredient-capture-plan §6.2).
 *
 * The three states a line can be in, because each gets a different control and
 * getting them crossed is the bug: nothing knows it (ask out loud), the model is
 * working on it (say so, ask nothing), or it has an aisle (a quiet way to move it).
 */

const eggs: GroceryItem = { key: "huevos", name_es: "Huevos", name_ca: "Ous", name_en: "Eggs", aisle: "dairy_eggs", is_pantry: false, default_unit: null };

function line(id: string, name: string, extra: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    id,
    display_name: name,
    normalised_name: name.toLowerCase(),
    grocery_key: null,
    unit: null,
    total_amount: null,
    is_checked: false,
    is_manual: true,
    sources: [],
    created_by: null,
    created_by_name: null,
    ...extra,
  };
}

function week(items: ShoppingListItem[]): MealPlan {
  return { id: "plan-1", kitchen_id: "k1", week_start: "2026-09-05", status: "planning", entries: [], items, created_by: null, created_at: "", updated_at: "" };
}

function setup(items: ShoppingListItem[], { editable = true, classifying = new Set<string>() } = {}) {
  const onFileAisle = vi.fn().mockResolvedValue(undefined);
  render(
    <LocaleProvider>
      <ShoppingList
        plan={week(items)}
        editable={editable}
        onTick={vi.fn()}
        onRemove={vi.fn()}
        onAddExtra={vi.fn()}
        onFileAisle={onFileAisle}
        classifying={classifying}
        currentUserId={null}
        vocabulary={[eggs]}
      />
    </LocaleProvider>,
  );
  return { onFileAisle };
}

const rowOf = (name: string) => screen.getByRole("checkbox", { name }).closest("li") as HTMLElement;

describe("a line nothing knows", () => {
  it("asks which aisle, and files it where you pick", async () => {
    const paper = line("l1", "Papel de horno");
    const { onFileAisle } = setup([paper]);

    fireEvent.click(within(rowOf("Papel de horno")).getByRole("button", { name: /which aisle/i }));
    fireEvent.click(screen.getByRole("button", { name: "Household" }));

    await waitFor(() => expect(onFileAisle).toHaveBeenCalledWith(paper, "household"));
    await waitFor(() => expect(screen.queryByRole("group", { name: /where is it/i })).not.toBeInTheDocument());
  });

  it("says the model is on it instead of asking, while it is", () => {
    setup([line("l1", "Papel de horno")], { classifying: new Set(["l1"]) });

    const row = rowOf("Papel de horno");
    expect(within(row).getByText(/finding its aisle/i)).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /which aisle/i })).not.toBeInTheDocument();
  });
});

describe("a line with an aisle", () => {
  it("does not ask — it offers a quiet way to move it, with the current aisle marked", () => {
    setup([line("l1", "Huevos", { grocery_key: "huevos", is_manual: false })]);

    const row = rowOf("Eggs");
    expect(within(row).queryByRole("button", { name: /which aisle/i })).not.toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: /change aisle: eggs/i }));

    expect(screen.getByRole("button", { name: "Dairy and eggs" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("lines that are not for filing", () => {
  it("offers nothing on a ticked line — it is already in the basket", () => {
    setup([line("l1", "Papel de horno", { is_checked: true })]);

    expect(within(rowOf("Papel de horno")).queryByRole("button", { name: /aisle/i })).not.toBeInTheDocument();
  });

  it("offers nothing on a week that can no longer change", () => {
    setup([line("l1", "Papel de horno"), line("l2", "Huevos", { grocery_key: "huevos" })], { editable: false });

    expect(screen.queryByRole("button", { name: /aisle/i })).not.toBeInTheDocument();
  });
});
