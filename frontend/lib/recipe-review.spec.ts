import { describe, expect, it } from "vitest";
import type { GroceryItem, RecipeDraft } from "@/lib/api-client";
import {
  acceptGrams,
  canSplit,
  compareReadings,
  ingredientsPayload,
  lineCount,
  missingFromMethod,
  rowsFromDraft,
  scaleRows,
  splitRow,
  unscaleRows,
  withName,
  type ReviewRow,
} from "@/lib/recipe-review";
import { byKey } from "@/lib/grocery";

const item = (key: string, over: Partial<GroceryItem> = {}): GroceryItem => ({
  key,
  name_es: key,
  name_ca: key,
  name_en: key,
  aisle: "produce",
  is_pantry: false,
  default_unit: null,
  ...over,
});

const VOCABULARY = [item("patata", { default_unit: "g", name_ca: "patata", name_en: "potato" }), item("pimienta", { name_ca: "pebre" }), item("sal"), item("pimiento"), item("cebolla", { name_ca: "ceba" })];
const vocabulary = byKey(VOCABULARY);

let ids = 0;
const nextId = () => ++ids;
const row = (over: Partial<ReviewRow>): ReviewRow => ({ id: nextId(), name: "", amount: "", unit: "", optional: false, ...over });

describe("rows from a draft", () => {
  const draft: RecipeDraft = {
    title: "Tortilla",
    servings: null,
    servings_from_source: false,
    prep_time_minutes: null,
    cook_time_minutes: null,
    tags: [],
    instructions: null,
    source_url: null,
    ingredient_lines: ["4 patatas", "kombucha", "6 huevos"],
    ingredients: [
      { line: 0, source_line: "4 patatas", name: "patata", amount: 4, unit: null, optional: false, item: VOCABULARY[0], new_item: null, did_you_mean: [], grams_suggestion: 800, restored: false },
      {
        line: 1,
        source_line: "kombucha",
        name: "kombucha",
        amount: null,
        unit: null,
        optional: true,
        item: null,
        new_item: { name_es: "kombucha", name_ca: "kombutxa", name_en: "kombucha", aisle: "drinks", is_pantry: false, default_unit: "ml" },
        did_you_mean: [],
        grams_suggestion: null,
        restored: false,
      },
      { line: 2, source_line: "6 huevos", name: "6 huevos", amount: null, unit: null, optional: false, item: null, new_item: null, did_you_mean: [], grams_suggestion: null, restored: true },
    ],
  };

  it("names each row in the reader's language and keeps what to offer", () => {
    const rows = rowsFromDraft(draft, "ca", nextId);

    expect(rows.map((r) => r.name)).toEqual(["patata", "kombutxa", "6 huevos"]);
    expect(rows[0]).toMatchObject({ groceryKey: "patata", gramsSuggestion: 800, defaultUnit: "g", amount: "4" });
    expect(rows[1]).toMatchObject({ newItem: { name_es: "kombucha" }, aisle: "drinks", optional: true });
    expect(rows[2].restored).toBe(true);
  });
});

describe("editing a name", () => {
  it("keeps a proposal while the name still says it, in any language", () => {
    const proposal = { name_es: "kombucha", name_ca: "kombutxa", name_en: "kombucha", aisle: "drinks" as const, is_pantry: false, default_unit: "ml" };
    const kombucha = row({ name: "kombutxa", newItem: proposal, aisle: "drinks" });

    expect(withName(kombucha, "Kombucha", vocabulary).newItem).toEqual(proposal);
    expect(withName(kombucha, "té", vocabulary).newItem).toBeUndefined();
  });

  it("finds the product again when its own name is typed back", () => {
    expect(withName(row({ name: "x" }), "Ceba", vocabulary)).toMatchObject({ groceryKey: "cebolla" });
  });
});

describe("grams for something bought by weight", () => {
  it("turns the count into grams and spends the suggestion", () => {
    expect(acceptGrams(row({ amount: "4", gramsSuggestion: 800 }))).toMatchObject({ amount: "800", unit: "g", gramsSuggestion: undefined });
  });
});

describe("splitting a line", () => {
  it("makes one row per ingredient on the same source line, without inventing amounts", () => {
    const salt = row({ name: "sal y pimienta", amount: "2", line: 3, sourceLine: "sal y pimienta" });

    expect(canSplit(salt)).toBe(true);
    const parts = splitRow(salt, vocabulary, nextId);
    expect(parts.map((p) => [p.name, p.groceryKey, p.amount, p.line])).toEqual([
      ["sal", "sal", "", 3],
      ["pimienta", "pimienta", "", 3],
    ]);
  });

  it("leaves a single ingredient alone", () => {
    expect(canSplit(row({ name: "cebolla grande" }))).toBe(false);
  });
});

describe("changing the servings", () => {
  it("scales every amount, and the undo puts back only what it changed", () => {
    const rows = [row({ amount: "500", unit: "g" }), row({ amount: "" }), row({ amount: "1,5" })];
    const { rows: scaled, before } = scaleRows(rows, 5, 3);

    expect(scaled.map((r) => r.amount)).toEqual(["300", "", "0.9"]);

    const edited = scaled.map((r, i) => (i === 2 ? { ...r, amount: "2" } : r));
    const written = new Map(scaled.map((r) => [r.id, r.amount]));
    expect(unscaleRows(edited, before, written).map((r) => r.amount)).toEqual(["500", "", "2"]);
  });
});

describe("the counter", () => {
  it("counts a line with no row left as removed by the person", () => {
    const rows = [row({ name: "sal", line: 0 }), row({ name: "pimienta", line: 0 }), row({ name: "aceite", line: 2 })];

    expect(lineCount(rows, 3)).toEqual({ lines: 3, rows: 3, removed: 1 });
  });
});

describe("ingredients only the method mentions", () => {
  it("finds whole words, plurals and Catalan names, and ignores what the list has", () => {
    const rows = [row({ name: "cebolla", groceryKey: "cebolla" })];

    const found = missingFromMethod("Sofríe la cebolla y añade los pimientos. Salpimienta la salsa.", rows, VOCABULARY);

    expect(found.map((i) => i.key)).toEqual(["pimiento"]);
  });
});

describe("reading again", () => {
  it("says what a new reading adds and takes away", () => {
    const now = [row({ name: "sal", groceryKey: "sal" }), row({ name: "pimienta", groceryKey: "pimienta" })];
    const next = [row({ name: "sal", groceryKey: "sal" }), row({ name: "pimiento", groceryKey: "pimiento" })];

    expect(compareReadings(now, next)).toEqual({ added: ["pimiento"], removed: ["pimienta"] });
  });
});

describe("what gets saved", () => {
  it("sends proposals only for rows not already in the vocabulary, and drops empty rows", () => {
    const proposal = { name_es: "kombucha", name_ca: "kombutxa", name_en: "kombucha", aisle: "drinks" as const, is_pantry: false, default_unit: "ml" };
    const payload = ingredientsPayload([row({ name: "patata", groceryKey: "patata", amount: "800", unit: "g" }), row({ name: "kombucha", newItem: proposal, optional: true }), row({ name: "  " })], 2);

    expect(payload).toEqual({
      servings: 2,
      items: [
        { name: "patata", amount: 800, unit: "g", optional: undefined, new_item: undefined },
        { name: "kombucha", amount: undefined, unit: undefined, optional: true, new_item: proposal },
      ],
    });
  });
});

describe("method mentions, covered by a more specific product", () => {
  it("does not ask for aceite when the list has aceite de oliva", () => {
    const vocab = [item("aceite", { name_ca: "oli" }), item("aceite de oliva", { name_ca: "oli d'oliva" })];
    const rows = [row({ name: "aceite de oliva", groceryKey: "aceite de oliva" })];

    expect(missingFromMethod("Sofríe en una olla con aceite.", rows, vocab)).toEqual([]);
  });

  it("scales the grams offer with the count", () => {
    const { rows } = scaleRows([row({ amount: "4", gramsSuggestion: 800 })], 4, 2);

    expect(rows[0].gramsSuggestion).toBe(400);
  });
});
