import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RecipeForm, { type RecipeFormValues } from "./RecipeForm";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import type { GroceryItem } from "@/lib/api-client";
import type { ReviewRow } from "@/lib/recipe-review";

/**
 * The form every recipe goes through — a draft read from text, a simple recipe,
 * an edit.
 *
 * **One thing here blocks, and only one**: a recipe with no ingredients. A
 * missing amount never does — three mandatory fields are what emptied these
 * columns in the first place (2 of 111 lines had an amount).
 */

const VOCABULARY: GroceryItem[] = [
  { key: "harina", name_es: "harina", name_ca: "farina", name_en: "flour", aisle: "dry_goods", is_pantry: true, default_unit: "g" },
  { key: "pimiento", name_es: "pimiento", name_ca: "pebrot", name_en: "pepper", aisle: "produce", is_pantry: false, default_unit: null },
];

let ids = 100;
const nextId = () => ++ids;
const row = (over: Partial<ReviewRow>): ReviewRow => ({ id: nextId(), name: "", amount: "", unit: "", optional: false, ...over });

const BASE: RecipeFormValues = {
  title: "Coca de llanda",
  instructions: "",
  food_type: "postre",
  source_url: "",
  prep_time_minutes: null,
  cook_time_minutes: null,
  tags: [],
  visibility: "public",
  servings: 4,
  servingsFromSource: false,
  rows: [],
  lines: [],
};

function setup(over: Partial<RecipeFormValues> = {}, props: { simple?: boolean } = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();
  render(
    <LocaleProvider>
      <RecipeForm initial={{ ...BASE, ...over }} vocabulary={VOCABULARY} nextId={nextId} onSubmit={onSubmit} onCancel={onCancel} submitLabel="Add recipe" {...props} />
    </LocaleProvider>,
  );
  return { onSubmit, onCancel };
}

const submit = () => screen.getByRole("button", { name: /add recipe/i });
const amounts = () => screen.getAllByRole("textbox", { name: /^amount$/i }).map((input) => (input as HTMLInputElement).value);

describe("the submit button", () => {
  it("is disabled while there is nothing to cook with, and says why", () => {
    setup();

    const reason = screen.getAllByText(/add at least one ingredient/i)[0];
    expect(submit()).toBeDisabled();
    expect(submit()).toHaveAttribute("aria-describedby", reason.id);
  });

  it("comes alive once a row has a name, even without an amount", () => {
    setup({ rows: [row({ name: "Aceite de oliva" })] });

    expect(submit()).toBeEnabled();
  });
});

describe("changing the servings", () => {
  it("scales the amounts, and the link under it puts them back", () => {
    setup({ rows: [row({ name: "harina", amount: "500", unit: "g" }), row({ name: "sal" })] });

    fireEvent.click(screen.getByRole("button", { name: /fewer servings/i }));
    expect(amounts()).toEqual(["375", ""]);

    fireEvent.click(screen.getByRole("button", { name: /the amounts were already for 3/i }));
    expect(amounts()).toEqual(["500", ""]);
    expect(screen.getByRole("spinbutton", { name: /servings/i })).toHaveValue(3);
  });

  it("undoes a chain of changes back to the amounts before the first", () => {
    setup({ rows: [row({ name: "harina", amount: "400", unit: "g" })] });

    fireEvent.click(screen.getByRole("button", { name: /fewer servings/i }));
    fireEvent.click(screen.getByRole("button", { name: /fewer servings/i }));
    expect(amounts()).toEqual(["200"]);

    fireEvent.click(screen.getByRole("button", { name: /the amounts were already for 2/i }));
    expect(amounts()).toEqual(["400"]);
  });
});

describe("the review", () => {
  it("offers the grams for a counted line of something bought by weight", () => {
    setup({ rows: [row({ name: "patata", amount: "4", line: 0, sourceLine: "4 patatas", defaultUnit: "g", gramsSuggestion: 800 })], lines: ["4 patatas"] });

    fireEvent.click(screen.getByRole("button", { name: /use ≈ 800 g/i }));

    expect(amounts()).toEqual(["800"]);
    expect(screen.getByDisplayValue("g")).toBeInTheDocument();
  });

  it("counts lines against ingredients, and says when a line was removed", () => {
    setup({ rows: [row({ name: "sal", line: 0 }), row({ name: "aceite", line: 1 })], lines: ["sal", "aceite"] });
    expect(screen.getByText("2 lines → 2 ingredients")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /remove ingredient: aceite/i }));

    expect(screen.getByText("2 lines → 1 ingredient")).toBeInTheDocument();
    expect(screen.getByText("(1 removed by you)")).toBeInTheDocument();
  });

  it("warns about a product only the method names, and adds it in one tap", () => {
    setup({ rows: [row({ name: "harina", groceryKey: "harina" })], instructions: "Mezcla la harina con el pimiento." });

    // Named in the reader's language — the test renders in English.
    fireEvent.click(screen.getByRole("button", { name: "pepper" }));

    expect(screen.getByDisplayValue("pepper")).toBeInTheDocument();
    expect(screen.queryByText(/the steps mention/i)).not.toBeInTheDocument();
  });

  it("splits a line that holds two ingredients", () => {
    setup({ rows: [row({ name: "sal y pimienta", line: 0 })], lines: ["sal y pimienta"] });

    fireEvent.click(screen.getByRole("button", { name: /^split$/i }));

    expect(screen.getByDisplayValue("sal")).toBeInTheDocument();
    expect(screen.getByDisplayValue("pimienta")).toBeInTheDocument();
  });
});

describe("submitting", () => {
  it("sends tags, visibility, times and optional ingredients", async () => {
    const { onSubmit } = setup({ rows: [row({ name: "harina", amount: "210", unit: "g" }), row({ name: "maíz", optional: true })] });

    fireEvent.click(screen.getByRole("button", { name: /lunchbox/i }));
    fireEvent.click(screen.getByRole("switch", { name: /only your kitchen/i }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /prep/i }), { target: { value: "10" } });
    await act(async () => fireEvent.click(submit()));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: ["tupper"],
        visibility: "kitchen",
        prep_time_minutes: 10,
        cook_time_minutes: null,
        ingredients: {
          servings: 4,
          items: [
            { name: "harina", amount: 210, unit: "g", optional: undefined, new_item: undefined },
            { name: "maíz", amount: undefined, unit: undefined, optional: true, new_item: undefined },
          ],
        },
      }),
    );
  });
});

describe("leaving", () => {
  it("goes straight back when nothing changed", () => {
    const { onCancel } = setup({ rows: [row({ name: "harina" })] });

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(onCancel).toHaveBeenCalled();
  });

  it("asks first when there is something to lose", () => {
    const { onCancel } = setup({ rows: [row({ name: "harina" })] });
    fireEvent.change(screen.getByDisplayValue("Coca de llanda"), { target: { value: "Coca" } });

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByText(/leave without saving\?/i)).toBeInTheDocument();
  });
});

describe("a simple recipe", () => {
  it("keeps the method out of the way until asked for", () => {
    setup({ servings: 1 }, { simple: true });

    expect(screen.queryByRole("textbox", { name: /method|instructions/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add steps/i })).toBeInTheDocument();
    expect(screen.getByText(/per person/i)).toBeInTheDocument();
  });
});
