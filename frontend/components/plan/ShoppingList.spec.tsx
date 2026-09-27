import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ShoppingList } from "./ShoppingList";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import type { GroceryItem, MealPlan, PlanEntry, ShoppingListItem } from "@/lib/api-client";

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
    pending_since: null,
    sources: [],
    created_by: null,
    created_by_name: null,
    ...extra,
  };
}

function week(items: ShoppingListItem[], entries: PlanEntry[] = []): MealPlan {
  return { id: "plan-1", kitchen_id: "k1", week_start: "2026-09-05", status: "planning", entries, items, created_by: null, created_at: "", updated_at: "" };
}

function setup(items: ShoppingListItem[], { editable = true, classifying = new Set<string>(), entries = [] as PlanEntry[] } = {}) {
  const onFileAisle = vi.fn().mockResolvedValue(undefined);
  const onOpenSlot = vi.fn();
  const onAddExtra = vi.fn().mockResolvedValue(undefined);
  const onSetAmount = vi.fn().mockResolvedValue(undefined);
  render(
    <LocaleProvider>
      <ShoppingList
        plan={week(items, entries)}
        editable={editable}
        onTick={vi.fn()}
        onRemove={vi.fn()}
        onAddExtra={onAddExtra}
        onSetAmount={onSetAmount}
        onFileAisle={onFileAisle}
        classifying={classifying}
        currentUserId={null}
        vocabulary={[eggs]}
        onOpenSlot={onOpenSlot}
      />
    </LocaleProvider>,
  );
  return { onFileAisle, onOpenSlot, onAddExtra, onSetAmount };
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

    fireEvent.click(within(row).getByRole("button", { name: /edit: eggs/i }));

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

describe("where a line comes from", () => {
  const lentejas: PlanEntry = {
    id: "e1",
    date: "2026-09-10",
    meal: "dinner",
    recipe_id: "r1",
    dish_name: "Lentejas",
    servings: 2,
    created_by: null,
    created_by_name: null,
  };

  it("links to the meal that put it there", () => {
    const { onOpenSlot } = setup([line("l1", "Cebolla", { is_manual: false, sources: [{ entry_id: "e1", dish_name: "Lentejas", amount: 1 }] })], {
      entries: [lentejas],
    });

    fireEvent.click(within(rowOf("Cebolla")).getByRole("button", { name: /lentejas/i }));

    expect(onOpenSlot).toHaveBeenCalledWith("2026-09-10", "dinner");
  });

  it("names a dish from another week without pretending it can go there", () => {
    // Carried from last week: its meal is not in this one, so there is no slot
    // here to open — the name still answers "why is this on the list?".
    setup([line("l1", "Azúcar", { is_manual: false, sources: [{ entry_id: "old", dish_name: "Bizcocho", amount: 1 }] })]);

    const row = rowOf("Azúcar");
    expect(within(row).getByText("Bizcocho")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /bizcocho/i })).not.toBeInTheDocument();
  });

  it("says since when it has been waiting, once it followed you from an earlier week", () => {
    setup([line("l1", "Azúcar", { pending_since: "2026-08-29" })]);

    expect(within(rowOf("Azúcar")).getByText(/pending since 29 aug/i)).toBeInTheDocument();
  });

  it("stops saying so once it is bought", () => {
    setup([line("l1", "Azúcar", { pending_since: "2026-08-29", is_checked: true })]);

    expect(within(rowOf("Azúcar")).queryByText(/pending since/i)).not.toBeInTheDocument();
  });
});

describe("how many", () => {
  const type = (text: string) => fireEvent.change(screen.getByRole("textbox", { name: /add something else/i }), { target: { value: text } });

  it("reads the number out of what you type, and says so before you add it", async () => {
    const { onAddExtra } = setup([]);

    type("4 manzanas amarillas");
    expect(screen.getByText("Will add: 4 × manzanas amarillas")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(onAddExtra).toHaveBeenCalledWith({ name: "manzanas amarillas", amount: 4, unit: null }));
  });

  it("keeps the number when you pick a suggestion", async () => {
    const { onAddExtra } = setup([]);

    type("6 egg");
    fireEvent.click(within(screen.getByRole("list", { name: /suggestions/i })).getByRole("button", { name: "Eggs" }));

    await waitFor(() => expect(onAddExtra).toHaveBeenCalledWith({ name: "Eggs", amount: 6, unit: null }));
  });

  it("changes a counted line one at a time", async () => {
    const apples = line("l1", "Manzana amarilla", { total_amount: 4 });
    const { onSetAmount } = setup([apples]);

    fireEvent.click(screen.getByRole("button", { name: /change amount: manzana amarilla, 4/i }));
    fireEvent.click(screen.getByRole("button", { name: /one more/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSetAmount).toHaveBeenCalledWith(apples, 5));
  });

  it("gives a line with no number one, from its edit panel", async () => {
    const coffee = line("l1", "Café");
    const { onSetAmount } = setup([coffee]);

    fireEvent.click(screen.getByRole("button", { name: /edit: café/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "Amount" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSetAmount).toHaveBeenCalledWith(coffee, 2));
  });

  it("types grams rather than stepping them, and keeps the unit", async () => {
    const feta = line("l1", "Queso feta", { total_amount: 200, unit: "g" });
    const { onSetAmount } = setup([feta]);

    fireEvent.click(screen.getByRole("button", { name: /change amount/i }));
    expect(screen.queryByRole("button", { name: /one more/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Amount" }), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSetAmount).toHaveBeenCalledWith(feta, 250));
  });

  it("will not save nothing, or zero", () => {
    setup([line("l1", "Café")]);

    fireEvent.click(screen.getByRole("button", { name: /edit: café/i }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Amount" }), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("leaves a bought line's number alone", () => {
    setup([line("l1", "Manzana amarilla", { total_amount: 4, is_checked: true })]);

    expect(screen.queryByRole("button", { name: /change amount/i })).not.toBeInTheDocument();
    expect(within(rowOf("Manzana amarilla")).getByText("4")).toBeInTheDocument();
  });
});
