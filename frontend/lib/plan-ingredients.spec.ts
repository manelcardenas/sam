import { describe, expect, it } from "vitest";
import { findExistingLine, formatAmount, linesFromEntry, normaliseName, scaleIngredients } from "./plan-ingredients";
import type { IngredientsData, ShoppingListItem } from "@/lib/api-client";

const recipe = (servings: number | null, items: IngredientsData["items"]): IngredientsData => ({ servings, items });

describe("scaleIngredients", () => {
  it("scales by the ratio of headcounts", () => {
    const lines = scaleIngredients(recipe(4, [{ name: "harina", amount: 200, unit: "g" }]), 2);

    expect(lines[0].amount).toBe(100);
    expect(lines[0].label).toBe("100 g");
  });

  it("scales up as well as down", () => {
    expect(scaleIngredients(recipe(2, [{ name: "huevos", amount: 3 }]), 6)[0].amount).toBe(9);
  });

  it("leaves amounts alone when the recipe states no headcount", () => {
    // 71% of production ingredient lines are in recipes with no `servings`.
    // Inventing a divisor would produce confident wrong numbers; passing them
    // through says "this is what the recipe says" and is at least true.
    const lines = scaleIngredients(recipe(null, [{ name: "harina", amount: 200, unit: "g" }]), 10);

    expect(lines[0].amount).toBe(200);
  });

  it("does not divide by zero", () => {
    expect(scaleIngredients(recipe(0, [{ name: "harina", amount: 200 }]), 4)[0].amount).toBe(200);
  });

  it("rounds to something a person would write down", () => {
    // 200/3 is 66.66666666666667. Nobody buys that.
    expect(scaleIngredients(recipe(3, [{ name: "harina", amount: 200, unit: "g" }]), 1)[0].amount).toBe(66.67);
  });

  it("gives an ingredient with no quantity no label at all", () => {
    // "sal" is a real ingredient. A "0" or a "1" here would be a quantity the
    // user never gave, and it would flow into the list's total.
    const lines = scaleIngredients(recipe(4, [{ name: "sal" }]), 8);

    expect(lines[0].amount).toBeNull();
    expect(lines[0].label).toBeNull();
  });

  it("keeps the unit out of the label when there isn't one", () => {
    expect(scaleIngredients(recipe(2, [{ name: "huevos", amount: 2 }]), 2)[0].label).toBe("2");
  });

  it("gives two lines with the same name distinct ids", () => {
    // Checkbox state is keyed on the id; a shared key would tick both at once.
    const lines = scaleIngredients(recipe(2, [{ name: "aceite", unit: "ml", amount: 50 }, { name: "aceite", unit: "cucharada", amount: 1 }]), 2);

    expect(lines[0].id).not.toBe(lines[1].id);
  });
});

describe("normaliseName", () => {
  /**
   * These cases are the same table the backend's `normalise_ingredient_name` is
   * tested against. The two must agree exactly: the popup uses this to find the
   * line already on the list, and the server uses its own to decide what to
   * merge into. Disagreement means the annotation points at a different row
   * than the one that actually gets the amount.
   */
  it.each([
    ["Cebolla", "cebolla"],
    ["  cebolla  ", "cebolla"],
    ["cebolla   tierna", "cebolla tierna"],
    ["plátano", "platano"],
    ["PLÁTANO", "  platano  "],
  ])("folds %j and %j together", (a, b) => {
    expect(normaliseName(a)).toBe(normaliseName(b));
  });

  it.each([
    ["cebolla", "cebollas"],
    ["pimiento", "pimienta"],
  ])("keeps %j and %j apart", (a, b) => {
    // No plural stemming, for the same reason the backend refuses it: the
    // second pair is why the first is left alone.
    expect(normaliseName(a)).not.toBe(normaliseName(b));
  });
});


const item = (over: Partial<ShoppingListItem>): ShoppingListItem => ({
  id: "i1",
  display_name: "Cebolla",
  normalised_name: "cebolla",
  grocery_key: null,
  unit: null,
  total_amount: 3,
  is_checked: false,
  is_manual: false,
  pending_since: null,
  sources: [],
  created_by: null,
  created_by_name: null,
  ...over,
});

describe("findExistingLine", () => {
  /**
   * This is the client's copy of the server's `merge_key`. If the two disagree,
   * the popup's "already on the list" annotation points at a different row than
   * the one that actually receives the amount — worse than no annotation,
   * because it is confidently wrong.
   */
  it("matches on the normalised name", () => {
    expect(findExistingLine([item({})], { key: "cebolla", unit: null })).toBeDefined();
  });

  it("treats a null unit and an empty unit as the same line", () => {
    // The COALESCE(unit, '') from the SQL index. Most household ingredients
    // have no unit, so this is the common case, not an edge one.
    expect(findExistingLine([item({ unit: null })], { key: "cebolla", unit: "" })).toBeDefined();
    expect(findExistingLine([item({ unit: "" })], { key: "cebolla", unit: null })).toBeDefined();
  });

  it("keeps different units apart", () => {
    // "2 cebollas" and "200g cebolla" stay two lines — no unit conversion, ever.
    expect(findExistingLine([item({ unit: "ml" })], { key: "cebolla", unit: "cucharada" })).toBeUndefined();
  });

  it("does not match a different ingredient", () => {
    expect(findExistingLine([item({})], { key: "cebollas", unit: null })).toBeUndefined();
  });

  it("is undefined against an empty list", () => {
    expect(findExistingLine([], { key: "cebolla", unit: null })).toBeUndefined();
  });
});

describe("formatAmount", () => {
  it("joins the amount and unit", () => {
    expect(formatAmount(200, "g")).toBe("200 g");
  });

  it("leaves the unit off when there isn't one", () => {
    expect(formatAmount(3, null)).toBe("3");
  });

  it("is null when there is no quantity, not '0'", () => {
    // "sal" has no amount. Rendering a 0 would be a quantity the user never gave.
    expect(formatAmount(null, "g")).toBeNull();
  });
});

describe("linesFromEntry", () => {
  it("finds the lines one slot put on the list", () => {
    const lines = [
      item({ id: "a", sources: [{ entry_id: "e1", dish_name: "Tortilla", amount: 1 }] }),
      item({ id: "b", sources: [{ entry_id: "e2", dish_name: "Lentejas", amount: 2 }] }),
    ];

    expect(linesFromEntry(lines, { id: "e1" }).map((l) => l.id)).toEqual(["a"]);
  });

  it("counts a line several dishes contributed to", () => {
    const shared = item({
      id: "a",
      sources: [
        { entry_id: "e1", dish_name: "Tortilla", amount: 1 },
        { entry_id: "e2", dish_name: "Lentejas", amount: 2 },
      ],
    });

    expect(linesFromEntry([shared], { id: "e2" })).toHaveLength(1);
  });

  it("ignores hand-added extras, which belong to no dish", () => {
    const manual = item({ id: "a", is_manual: true, sources: [] });

    expect(linesFromEntry([manual], { id: "e1" })).toEqual([]);
  });
});
