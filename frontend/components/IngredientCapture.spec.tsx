import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IngredientCapture, rowsFromRawText, type CaptureRow } from "./IngredientCapture";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { apiClient, type GroceryItem, type ParsedIngredientLine } from "@/lib/api-client";

/**
 * One box in, reviewable rows out (docs/plans/ingredient-capture-plan.md §4).
 *
 * The two things here that lose real work when wrong: the form must still save
 * when every provider is down, and a missing amount must never block — both are
 * the friction that emptied the fields in the first place.
 */

function grocery(key: string, overrides: Partial<GroceryItem> = {}): GroceryItem {
  return { key, name_es: key, name_ca: key, name_en: key, aisle: "produce", is_pantry: false, default_unit: null, ...overrides };
}

function parsed(item: GroceryItem, overrides: Partial<ParsedIngredientLine> = {}): ParsedIngredientLine {
  return { raw: item.key, item, amount: null, unit: null, is_new: false, did_you_mean: [], ...overrides };
}

function setup(rows: CaptureRow[] = []) {
  const onRowsChange = vi.fn();
  const { rerender } = render(
    <LocaleProvider>
      <IngredientCapture rows={rows} onRowsChange={onRowsChange} servings={4} nextId={(() => { let n = 0; return () => n++; })()} />
    </LocaleProvider>,
  );
  return { onRowsChange, rerender };
}

beforeEach(() => vi.restoreAllMocks());

describe("the box", () => {
  it("is where a new recipe starts", () => {
    setup([]);

    expect(screen.getByRole("textbox", { name: /ingredients/i })).toBeInTheDocument();
  });

  it("sends the text and the headcount", async () => {
    const parse = vi.spyOn(apiClient, "parseIngredients").mockResolvedValue({ lines: [] });
    setup([]);

    fireEvent.change(screen.getByRole("textbox", { name: /ingredients/i }), { target: { value: "2 cebollas" } });
    fireEvent.click(screen.getByRole("button", { name: /tidy up/i }));

    await waitFor(() => expect(parse).toHaveBeenCalledWith("2 cebollas", 4));
  });

  it("will not call out for an empty box", () => {
    const parse = vi.spyOn(apiClient, "parseIngredients");
    setup([]);

    expect(screen.getByRole("button", { name: /tidy up/i })).toBeDisabled();
    expect(parse).not.toHaveBeenCalled();
  });

  it("turns the answer into editable rows", async () => {
    vi.spyOn(apiClient, "parseIngredients").mockResolvedValue({
      lines: [parsed(grocery("cebolla"), { amount: 2 })],
    });
    const { onRowsChange } = setup([]);

    fireEvent.change(screen.getByRole("textbox", { name: /ingredients/i }), { target: { value: "2 cebollas" } });
    fireEvent.click(screen.getByRole("button", { name: /tidy up/i }));

    await waitFor(() => expect(onRowsChange).toHaveBeenCalled());
    expect(onRowsChange.mock.calls[0][0]).toEqual([expect.objectContaining({ name: "cebolla", amount: "2" })]);
  });
});

describe("when every provider is down", () => {
  it("still produces rows rather than an error", async () => {
    // Non-negotiable: an unreachable third-party API must not stop you saving a
    // recipe. This is the same path a timeout, a rate limit and a cold start take.
    vi.spyOn(apiClient, "parseIngredients").mockRejectedValue(new Error("503"));
    const { onRowsChange } = setup([]);

    fireEvent.change(screen.getByRole("textbox", { name: /ingredients/i }), { target: { value: "2 cebollas\nsal" } });
    fireEvent.click(screen.getByRole("button", { name: /tidy up/i }));

    await waitFor(() => expect(onRowsChange).toHaveBeenCalled());
    expect(onRowsChange.mock.calls[0][0].map((r: CaptureRow) => r.name)).toEqual(["2 cebollas", "sal"]);
  });

  it("splits raw text on lines and drops the blanks", () => {
    let n = 0;
    expect(rowsFromRawText("  2 cebollas \n\n  sal  \n", () => n++)).toEqual([
      { id: 0, name: "2 cebollas", amount: "", unit: "" },
      { id: 1, name: "sal", amount: "", unit: "" },
    ]);
  });
});

describe("the review table", () => {
  const rows: CaptureRow[] = [
    { id: 0, name: "Cebolla", amount: "2", unit: "", aisle: "produce" },
    { id: 1, name: "Aceite de oliva", amount: "", unit: "", aisle: "condiments", isPantry: true },
    { id: 2, name: "Huveos", amount: "", unit: "", aisle: "dairy_eggs", isNew: true, didYouMean: ["Huevos"] },
    { id: 3, name: "Queso parmesano", amount: "", unit: "", aisle: "dairy_eggs", expectsAmount: true },
  ];

  it("opens straight into the table when there is something to review", () => {
    setup(rows);

    expect(screen.queryByRole("textbox", { name: /ingredients/i })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Cebolla")).toBeInTheDocument();
  });

  it("names the aisle each line will be found in", () => {
    setup(rows);

    expect(screen.getByText("Fruit and veg")).toBeInTheDocument();
  });

  it("marks a row that is new to the vocabulary", () => {
    // Also the typo detector: you have added eggs twenty times, so this badge
    // beside "Huveos" is wrong in a way you spot instantly.
    setup(rows);

    expect(screen.getByText(/new/)).toBeInTheDocument();
  });

  it("marks a pantry staple", () => {
    setup(rows);

    expect(screen.getByText(/at home/)).toBeInTheDocument();
  });

  it("nudges for a quantity only where one is expected", () => {
    setup(rows);

    // `Queso parmesano` is weighed, so it gets asked. `Aceite de oliva` has no
    // amount either and is not asked, because a nudge on everything is noise.
    expect(screen.getAllByText(/how much/)).toHaveLength(1);
  });

  it("offers a near miss as a question, and taking it clears the badge", () => {
    const { onRowsChange } = setup(rows);

    fireEvent.click(screen.getByRole("button", { name: "Huevos?" }));

    expect(onRowsChange.mock.calls[0][0][2]).toEqual(expect.objectContaining({ name: "Huevos", isNew: false, didYouMean: [] }));
  });

  it("lets a row be added by hand", () => {
    const { onRowsChange } = setup(rows);

    fireEvent.click(screen.getByRole("button", { name: /add ingredient/i }));

    expect(onRowsChange.mock.calls[0][0]).toHaveLength(rows.length + 1);
  });

  it("goes back to the box, clearing the rows", () => {
    const { onRowsChange } = setup(rows);

    fireEvent.click(screen.getByRole("button", { name: /back to the text/i }));

    expect(onRowsChange).toHaveBeenCalledWith([]);
  });
});
