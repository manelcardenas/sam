import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SlotSheet } from "./SlotSheet";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { apiClient, type MealPlan, type ParsedIngredientLine, type PlanEntry, type Recipe, type ShoppingListItem } from "@/lib/api-client";

/**
 * The one modal the planner has, now that **a slot holds several dishes**
 * (docs/plans/ingredient-capture-plan.md §5).
 *
 * What is pinned here is the flow, not the markup: a filled slot opens on its
 * list rather than inside one dish; finishing with a dish returns to that list
 * instead of closing the sheet; and the headcount is the slot's, so changing it
 * writes through to every dish rather than to whichever one you happened to
 * open. Quick-create is here for the same reason: the tap that matters is the
 * one that turns a dish you invented into ingredients on the shopping list, and
 * the alternative path — typing the same word as free text — is faster every
 * time and buys nothing (§5.3).
 */

const SATURDAY = "2026-09-12";

function entry(id: string, dish_name: string, extra: Partial<PlanEntry> = {}): PlanEntry {
  return { id, date: SATURDAY, meal: "dinner", recipe_id: null, dish_name, servings: 2, created_by: null, created_by_name: null, ...extra };
}

function plan(entries: PlanEntry[], items: ShoppingListItem[] = []): MealPlan {
  return { id: "plan-1", kitchen_id: "k1", week_start: SATURDAY, status: "planning", entries, items, created_by: null, created_at: "", updated_at: "" };
}

/** A list line this dish put there, so the slot counts as "on the list". */
function listed(name: string, entryId: string, dishName: string): ShoppingListItem {
  return {
    id: `line-${name}`,
    display_name: name,
    normalised_name: name,
    grocery_key: null,
    unit: null,
    total_amount: 2,
    is_checked: false,
    is_manual: false,
    sources: [{ entry_id: entryId, dish_name: dishName, amount: 2 }],
    created_by: null,
    created_by_name: null,
  };
}

function recipe(id: string, title: string, overrides: Partial<Recipe> = {}): Recipe {
  return {
    id,
    title,
    instructions: null,
    ingredients: { servings: 1, items: [{ name: "arroz", amount: 80, unit: "g" }] },
    food_type: "guarnicion",
    created_at: "",
    updated_at: "",
    created_by: null,
    created_by_name: null,
    ...overrides,
  } as Recipe;
}

function setup(entries: PlanEntry[], recipes: Recipe[] = [], items: ShoppingListItem[] = []) {
  // Echoes what it was given, the way the server does: the sheet scales the
  // ingredient step by the entry it gets back, so a mock with a fixed headcount
  // would let a wrong one through unnoticed.
  const onAssign = vi.fn(async (recipe: Recipe | null, name: string, servings: number) =>
    entry("new", name, { servings, recipe_id: recipe?.id ?? null }),
  );
  const onCreateRecipe = vi.fn().mockImplementation(async () => recipe("r-new", "Arroz blanco"));
  const onRemove = vi.fn().mockResolvedValue(undefined);
  const onAddToList = vi.fn().mockResolvedValue(undefined);
  const onResyncList = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();

  // The sheet reads the dish it just saved back out of `entries` — that is how
  // it survives the parent refetching the plan. A harness that never adds the
  // new entry is a harness where the ingredient step is unreachable, so this
  // stands in for `applyUpdatedPlan`.
  function Harness() {
    const [live, setLive] = useState(entries);
    return (
      <SlotSheet
        plan={plan(live, items)}
        entries={live}
        dayLabel="Saturday"
        mealLabel="Dinner"
        recipes={recipes}
        vocabulary={[]}
        editable
        listEditable
        onAssign={async (recipe, name, servings) => {
          const saved = await onAssign(recipe, name, servings);
          // Upsert by dish, the way `upsert_entry` does: re-assigning a dish
          // that is already in the slot *replaces* it — which is exactly what a
          // headcount change is. Appending instead would leave the old servings
          // in place and quietly make every scaling assertion test nothing.
          if (saved)
            setLive((prev) => {
              const at = prev.findIndex((e) => e.dish_name === saved.dish_name);
              if (at === -1) return [...prev, saved];
              const next = [...prev];
              next[at] = { ...saved, id: prev[at].id };
              return next;
            });
          return saved;
        }}
        onCreateRecipe={onCreateRecipe}
        onAddToList={onAddToList}
        onResyncList={onResyncList}
        onRemove={onRemove}
        onClose={onClose}
        currentUserId={null}
      />
    );
  }

  render(
    <LocaleProvider>
      <Harness />
    </LocaleProvider>,
  );
  return { onAssign, onCreateRecipe, onRemove, onAddToList, onResyncList, onClose };
}

beforeEach(() => vi.restoreAllMocks());

/** One structured line, as a reachable provider would answer. */
const ARROZ: ParsedIngredientLine = {
  raw: "80 g de arroz",
  item: { key: "arroz", name_es: "Arroz", name_ca: "Arròs", name_en: "Rice", aisle: "dry_goods", is_pantry: false, default_unit: "g" },
  amount: 80,
  unit: "g",
  is_new: false,
  did_you_mean: [],
};

function parses(lines: ParsedIngredientLine[] = [ARROZ]) {
  return vi.spyOn(apiClient, "parseIngredients").mockResolvedValue({ lines });
}

/** Walk from an open slot to a filled-in create form. */
async function openCreateForm(query: string, ingredients = "80 g de arroz") {
  fireEvent.click(screen.getByRole("button", { name: "Add a dish" }));
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: query } });
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`create.*${query}`, "i") }));
  fireEvent.change(screen.getByRole("textbox", { name: /ingredients/i }), { target: { value: ingredients } });
  fireEvent.click(screen.getByRole("button", { name: /tidy up/i }));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: /ingredients/i })).not.toBeInTheDocument());
}

describe("opening a slot", () => {
  it("shows everything planned for the meal", () => {
    setup([entry("a", "Carne en salsa"), entry("b", "Arroz blanco")]);

    expect(screen.getByText("Carne en salsa")).toBeInTheDocument();
    expect(screen.getByText("Arroz blanco")).toBeInTheDocument();
  });

  it("goes straight to the picker when the slot is empty", () => {
    // An empty slot has no list worth showing, and a screen that says "nothing
    // here, tap to add" is a tap nobody wants to make.
    setup([]);

    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it("offers a way to add another dish", () => {
    setup([entry("a", "Carne en salsa")]);

    fireEvent.click(screen.getByRole("button", { name: "Add a dish" }));

    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });
});

describe("the headcount", () => {
  it("is the largest any dish is sized for", () => {
    setup([entry("a", "Carne en salsa", { servings: 2 }), entry("b", "Arroz blanco", { servings: 4 })]);

    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("writes through to every dish, so one number means one slot", async () => {
    const { onAssign } = setup([entry("a", "Carne en salsa"), entry("b", "Arroz blanco")]);

    fireEvent.click(screen.getByRole("button", { name: "+" }));

    await waitFor(() => expect(onAssign).toHaveBeenCalledTimes(2));
    expect(onAssign.mock.calls.map((call) => call[1])).toEqual(["Carne en salsa", "Arroz blanco"]);
    expect(onAssign.mock.calls.every((call) => call[2] === 3)).toBe(true);
  });

  it("skips a dish that is already at the new headcount", async () => {
    const { onAssign } = setup([entry("a", "Carne en salsa", { servings: 2 }), entry("b", "Arroz blanco", { servings: 3 })]);

    // Slot starts at 3 — the largest — so stepping down to 2 leaves the meat alone.
    fireEvent.click(screen.getByRole("button", { name: "−" }));

    await waitFor(() => expect(onAssign).toHaveBeenCalledTimes(1));
    expect(onAssign.mock.calls[0][1]).toBe("Arroz blanco");
  });
});

describe("removing a dish", () => {
  it("asks first, naming the dish", () => {
    setup([entry("a", "Carne en salsa"), entry("b", "Arroz blanco")]);

    fireEvent.click(screen.getByRole("button", { name: "Remove from the week: Arroz blanco" }));

    // The whole sentence, not just the name: the sheet header also says it, and
    // a bare name match would pass on the screen before the confirmation.
    expect(screen.getByText("Remove Arroz blanco from Saturday · Dinner?")).toBeInTheDocument();
  });

  it("returns to the slot when other dishes remain", async () => {
    const { onRemove, onClose } = setup([entry("a", "Carne en salsa"), entry("b", "Arroz blanco")]);

    fireEvent.click(screen.getByRole("button", { name: "Remove from the week: Arroz blanco" }));
    fireEvent.click(screen.getByRole("button", { name: /keep/i }));

    await waitFor(() => expect(onRemove).toHaveBeenCalled());
    // Closing here would make you reopen the same slot to reach the other dish.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the sheet when it was the last dish", async () => {
    const { onClose } = setup([entry("a", "Carne en salsa")]);

    fireEvent.click(screen.getByRole("button", { name: "Remove from the week: Carne en salsa" }));
    fireEvent.click(screen.getByRole("button", { name: /keep/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe("inventing a dish without leaving the week", () => {
  it("carries the search across, so the name is not typed twice", () => {
    setup([entry("a", "Carne en salsa")]);

    fireEvent.click(screen.getByRole("button", { name: "Add a dish" }));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "Arroz blanco" } });
    fireEvent.click(screen.getByRole("button", { name: /create.*arroz blanco/i }));

    expect(screen.getByRole("textbox", { name: /^title/i })).toHaveValue("Arroz blanco");
  });

  it("defaults to a side, priced per person", async () => {
    // §5.4: `Arroz blanco` is written as 80g for one and multiplied by the slot.
    // Defaulting to the slot's four would double-count it the moment ADR-0001
    // scaled it, and 320g of rice per head is the kind of wrong nobody reads
    // back off a shopping list.
    const { onCreateRecipe } = setup([entry("a", "Carne en salsa", { servings: 4 })]);
    parses();

    await openCreateForm("Arroz blanco");
    expect(screen.getByRole("button", { name: "Side", pressed: true })).toBeInTheDocument();
    // Said out loud, because 80g for a meal for four looks like a mistake.
    expect(screen.getByText(/scaled up for the 4 people/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /create and add/i }));

    await waitFor(() => expect(onCreateRecipe).toHaveBeenCalled());
    expect(onCreateRecipe.mock.calls[0][0].ingredients.servings).toBe(1);
  });

  it("writes a main for the table instead, since that is how you wrote it down", async () => {
    const { onCreateRecipe } = setup([entry("a", "Carne en salsa", { servings: 4 })]);
    parses();

    await openCreateForm("Lentejas");
    fireEvent.click(screen.getByRole("button", { name: "Mains" }));
    fireEvent.click(screen.getByRole("button", { name: /create and add/i }));

    await waitFor(() => expect(onCreateRecipe).toHaveBeenCalled());
    expect(onCreateRecipe.mock.calls[0][0].ingredients.servings).toBe(4);
  });

  it("puts the basis back to one when you change your mind back to a side", async () => {
    // Only reachable by changing category twice, and it is the same 320g-per-head
    // mistake as the default: a side you reconsidered is still written per person.
    const { onCreateRecipe } = setup([entry("a", "Carne en salsa", { servings: 4 })]);
    parses();

    await openCreateForm("Arroz blanco");
    fireEvent.click(screen.getByRole("button", { name: "Mains" }));
    fireEvent.click(screen.getByRole("button", { name: "Side" }));
    fireEvent.click(screen.getByRole("button", { name: /create and add/i }));

    await waitFor(() => expect(onCreateRecipe).toHaveBeenCalled());
    expect(onCreateRecipe.mock.calls[0][0].ingredients.servings).toBe(1);
  });

  it("leaves the basis alone once you have set it yourself", async () => {
    const { onCreateRecipe } = setup([entry("a", "Carne en salsa", { servings: 4 })]);
    parses();

    await openCreateForm("Arroz blanco");
    fireEvent.click(screen.getByRole("button", { name: "+" }));
    // Switching category after deciding must not silently undo the decision.
    fireEvent.click(screen.getByRole("button", { name: "Mains" }));
    fireEvent.click(screen.getByRole("button", { name: /create and add/i }));

    await waitFor(() => expect(onCreateRecipe).toHaveBeenCalled());
    expect(onCreateRecipe.mock.calls[0][0].ingredients.servings).toBe(2);
  });

  it("saves the dish and puts it in the slot in one action", async () => {
    const { onCreateRecipe, onAssign } = setup([entry("a", "Carne en salsa", { servings: 4 })]);
    parses();

    await openCreateForm("Arroz blanco");
    fireEvent.click(screen.getByRole("button", { name: /create and add/i }));

    await waitFor(() => expect(onAssign).toHaveBeenCalled());
    expect(onCreateRecipe).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Arroz blanco", food_type: "guarnicion", instructions: null }),
    );
    // The slot's headcount, not the recipe's: 80g for one, cooked for four.
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ id: "r-new" }), "Arroz blanco", 4);
  });

  it("lands on the new dish's ingredients, already scaled to the meal", async () => {
    // The payoff, and the whole reason this beats typing "arroz" as free text:
    // 80g written for one person, four people eating, 320g on the list. It also
    // pins that the sheet can read the dish it just invented — the parent has
    // not necessarily folded it into `recipes` yet.
    setup([entry("a", "Carne en salsa", { servings: 4 })]);
    parses();

    await openCreateForm("Arroz blanco");
    fireEvent.click(screen.getByRole("button", { name: /create and add/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Add to the list" })).toBeInTheDocument());
    expect(screen.getByText("320 g")).toBeInTheDocument();
  });

  it("still works with every provider down", async () => {
    // The whole point of the fallback: a dish invented here with no model
    // reachable must still reach the shopping list, or the feature is only as
    // available as DeepSeek is.
    const { onCreateRecipe } = setup([entry("a", "Carne en salsa")]);
    vi.spyOn(apiClient, "parseIngredients").mockRejectedValue(new Error("503"));

    await openCreateForm("Arroz blanco", "80 g de arroz");
    fireEvent.click(screen.getByRole("button", { name: /create and add/i }));

    await waitFor(() => expect(onCreateRecipe).toHaveBeenCalled());
    expect(onCreateRecipe.mock.calls[0][0].ingredients.items).toEqual([{ name: "80 g de arroz", amount: undefined, unit: undefined }]);
  });

  it("will not create a dish with nothing to buy", async () => {
    // A guarnición with no ingredients contributes nothing to the list, which is
    // exactly the one-off text entry this screen exists to beat.
    setup([entry("a", "Carne en salsa")]);

    fireEvent.click(screen.getByRole("button", { name: "Add a dish" }));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "Arroz blanco" } });
    fireEvent.click(screen.getByRole("button", { name: /create.*arroz blanco/i }));

    expect(screen.getByRole("button", { name: /create and add/i })).toBeDisabled();
    expect(screen.getByText(/tidy the ingredients up/i)).toBeInTheDocument();
  });

  it("will not create a nameless dish", async () => {
    setup([entry("a", "Carne en salsa")]);
    parses();

    await openCreateForm("Arroz blanco");
    fireEvent.change(screen.getByRole("textbox", { name: /^title/i }), { target: { value: "  " } });

    expect(screen.getByRole("button", { name: /create and add/i })).toBeDisabled();
  });
});

describe("the shopping list after a headcount change", () => {
  const RICE = recipe("r-arroz", "Arroz blanco");

  function slotOnTheList() {
    return setup([entry("a", "Arroz blanco", { servings: 2, recipe_id: "r-arroz" })], [RICE], [listed("arroz", "a", "Arroz blanco")]);
  }

  it("says the list is out of date, naming the headcount it still holds", async () => {
    // The whole bug: the list is a snapshot taken at "add to the list" time, and
    // nothing ever went back to it. Silence here is how you shop for two.
    slotOnTheList();

    fireEvent.click(screen.getByRole("button", { name: "+" }));

    await waitFor(() => expect(screen.getByText(/still has the amounts for 2 people/i)).toBeInTheDocument());
  });

  it("stays quiet when nothing of this slot is on the list yet", async () => {
    // Nothing is stale, so there is nothing to offer. An unconditional banner
    // would fire on the first headcount anyone sets, which is every slot.
    const { onAssign } = setup([entry("a", "Arroz blanco", { servings: 2, recipe_id: "r-arroz" })], [RICE]);

    fireEvent.click(screen.getByRole("button", { name: "+" }));

    await waitFor(() => expect(onAssign).toHaveBeenCalled());
    expect(screen.queryByText(/still has the amounts/i)).not.toBeInTheDocument();
  });

  it("asks once, not once per tap", async () => {
    // 2 → 5 is three taps and one decision. A confirm dialog per tap is the
    // reason this is a banner.
    slotOnTheList();

    fireEvent.click(screen.getByRole("button", { name: "+" }));
    fireEvent.click(screen.getByRole("button", { name: "+" }));
    fireEvent.click(screen.getByRole("button", { name: "+" }));

    await waitFor(() => expect(screen.getAllByText(/still has the amounts for 2 people/i)).toHaveLength(1));
  });

  it("keeps naming the headcount the list was built for, not the last one", async () => {
    // Re-reading it on each tap would walk the number up with you — 2 → 3 → 4 —
    // and the sentence would end up describing a state the list was never in.
    // Only reproducible with a render between the taps, which is how a thumb
    // does it and how the first version of this test did not.
    slotOnTheList();

    fireEvent.click(screen.getByRole("button", { name: "+" }));
    await screen.findByText(/still has the amounts for 2 people/i);
    fireEvent.click(screen.getByRole("button", { name: "+" }));
    await waitFor(() => expect(screen.getByText("4")).toBeInTheDocument());

    expect(screen.getByText(/still has the amounts for 2 people/i)).toBeInTheDocument();
  });

  it("stops asking once the list is updated", async () => {
    // The banner is a question, and a question that stays on screen after it is
    // answered reads as a failed save.
    const { onResyncList } = slotOnTheList();

    fireEvent.click(screen.getByRole("button", { name: "+" }));
    fireEvent.click(await screen.findByRole("button", { name: /update 1 line/i }));

    await waitFor(() => expect(onResyncList).toHaveBeenCalled());
    expect(screen.queryByText(/still has the amounts/i)).not.toBeInTheDocument();
  });

  it("rebuilds the lines at the new headcount when told to", async () => {
    const { onResyncList } = slotOnTheList();

    fireEvent.click(screen.getByRole("button", { name: "+" }));
    fireEvent.click(await screen.findByRole("button", { name: /update 1 line/i }));

    await waitFor(() => expect(onResyncList).toHaveBeenCalled());
    // Scaled from the recipe's own basis (80g for 1) to the new headcount — not
    // multiplied out of the list's merged total, which other dishes share.
    expect(onResyncList.mock.calls[0][1]).toEqual([expect.objectContaining({ name: "arroz", amount: 240 })]);
  });

  it("leaves the list exactly as it was if you say no", async () => {
    const { onResyncList } = slotOnTheList();

    fireEvent.click(screen.getByRole("button", { name: "+" }));
    fireEvent.click(await screen.findByRole("button", { name: /leave them/i }));

    expect(onResyncList).not.toHaveBeenCalled();
    expect(screen.queryByText(/still has the amounts/i)).not.toBeInTheDocument();
  });
});
