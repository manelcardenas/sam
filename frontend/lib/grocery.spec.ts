import { describe, expect, it } from "vitest";
import type { GroceryItem, MealPlan, ShoppingListItem } from "@/lib/api-client";
import { AISLES, aisleOrder, byKey, displayName, groceryFor, groupByAisle, isUnreviewed, lineToClassify, nameFor, narrowVocabulary, resolveKey, suggest } from "@/lib/grocery";

function grocery(key: string, overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    key,
    name_es: key,
    name_ca: key,
    name_en: key,
    aisle: "other",
    is_pantry: false,
    default_unit: null,
    ...overrides,
  };
}

function line(normalised_name: string, grocery_key: string | null = null): ShoppingListItem {
  return {
    id: normalised_name,
    display_name: normalised_name,
    normalised_name,
    grocery_key,
    unit: null,
    total_amount: null,
    is_checked: false,
    is_manual: false,
    sources: [],
    created_by: null,
    created_by_name: null,
  };
}

describe("the aisle order", () => {
  it("is the order you walk the shop, not the alphabet", () => {
    const alphabetical = [...AISLES].sort();

    expect(AISLES).not.toEqual(alphabetical);
    expect(AISLES[0]).toBe("produce");
    expect(AISLES.at(-1)).toBe("other");
  });

  it("gives every aisle one position", () => {
    expect(AISLES.map(aisleOrder)).toEqual(AISLES.map((_, index) => index));
  });

  it("matches the backend enum", () => {
    // Mirrors `domain/entities/grocery.py::Aisle`. If the two drift, the list
    // sorts one way on the server and another in the browser, and nothing else
    // would say so.
    expect(AISLES).toEqual([
      "produce",
      "bakery",
      "meat_fish",
      "dairy_eggs",
      "frozen",
      "canned",
      "dry_goods",
      "condiments",
      "drinks",
      "household",
      "other",
    ]);
  });
});

describe("grouping the list by aisle", () => {
  const vocabulary = byKey([
    grocery("cebolla", { aisle: "produce" }),
    grocery("huevos", { aisle: "dairy_eggs" }),
    grocery("detergente", { aisle: "household" }),
  ]);

  it("puts each line under the shelf it is found on, in walking order", () => {
    const groups = groupByAisle([line("detergente"), line("huevos"), line("cebolla")], vocabulary);

    expect(groups.map((g) => g.aisle)).toEqual(["produce", "dairy_eggs", "household"]);
  });

  it("drops aisles with nothing in them", () => {
    const groups = groupByAisle([line("huevos")], vocabulary);

    expect(groups).toHaveLength(1);
  });

  it("sends an unrecognised line to the end rather than losing it", () => {
    // The whole degradation story: a line the vocabulary has never heard of is
    // still a thing you have to buy.
    const groups = groupByAisle([line("salsa teriyaki"), line("cebolla")], vocabulary);

    expect(groups.map((g) => g.aisle)).toEqual(["produce", "other"]);
    expect(groups[1].items.map((i) => i.display_name)).toEqual(["salsa teriyaki"]);
  });

  it("keeps every line when the vocabulary is empty", () => {
    const groups = groupByAisle([line("huevos"), line("cebolla")], new Map());

    expect(groups).toEqual([{ aisle: "other", items: [line("huevos"), line("cebolla")] }]);
  });

  it("preserves the order the server sent within a group", () => {
    const vocab = byKey([grocery("cebolla", { aisle: "produce" }), grocery("apio", { aisle: "produce" })]);

    const groups = groupByAisle([line("apio"), line("cebolla")], vocab);

    expect(groups[0].items.map((i) => i.display_name)).toEqual(["apio", "cebolla"]);
  });
});

describe("the name a reader sees", () => {
  const huevos = grocery("huevos", { name_es: "Huevos", name_ca: "Ous", name_en: "Eggs" });

  it("answers in their language", () => {
    expect(nameFor(huevos, "es")).toBe("Huevos");
    expect(nameFor(huevos, "ca")).toBe("Ous");
    expect(nameFor(huevos, "en")).toBe("Eggs");
  });

  it("falls back to Spanish, never to blank", () => {
    expect(nameFor(huevos, "fr")).toBe("Huevos");
    expect(nameFor(grocery("x", { name_es: "Equis", name_en: "" }), "en")).toBe("Equis");
  });
});

describe("suggestions for the add box", () => {
  const vocabulary = [
    grocery("pan", { name_es: "Pan", name_ca: "Pa", name_en: "Bread" }),
    grocery("pasta de dientes", { name_es: "Pasta de dientes", name_ca: "Pasta de dents", name_en: "Toothpaste" }),
    grocery("huevos", { name_es: "Huevos", name_ca: "Ous", name_en: "Eggs" }),
    grocery("platano", { name_es: "Plátano", name_ca: "Plàtan", name_en: "Banana" }),
    // Contains "pa" without starting with it — the case that tells prefix
    // ranking apart from plain substring matching.
    grocery("sopa", { name_es: "Sopa", name_ca: "Sopa", name_en: "Soup" }),
  ];

  it("offers nothing for an empty box", () => {
    expect(suggest("", vocabulary)).toEqual([]);
    expect(suggest("   ", vocabulary)).toEqual([]);
  });

  it("ranks every prefix above any match in the middle", () => {
    // `sopa` contains "pa"; `pan` and `pasta de dientes` begin with it. Typing
    // two letters should not surface soup above bread.
    const names = suggest("pa", vocabulary).map((i) => i.key);

    expect(names).toEqual(["pan", "pasta de dientes", "sopa"]);
  });

  it("finds a row typed in another language", () => {
    // The point of three names: typing `eggs` with the app in Spanish still
    // reaches the row, because they are one row and one shopping-list line.
    expect(suggest("eggs", vocabulary).map((i) => i.key)).toEqual(["huevos"]);
    expect(suggest("ous", vocabulary).map((i) => i.key)).toEqual(["huevos"]);
  });

  it("ignores accents, the way a phone keyboard does", () => {
    expect(suggest("platano", vocabulary).map((i) => i.key)).toEqual(["platano"]);
    expect(suggest("plá", vocabulary).map((i) => i.key)).toEqual(["platano"]);
  });

  it("caps how many it offers", () => {
    const many = Array.from({ length: 20 }, (_, i) => grocery(`cosa ${i}`));

    expect(suggest("cosa", many)).toHaveLength(6);
  });
});

describe("resolveKey", () => {
  const vocabulary = byKey([
    grocery("cebolla", { name_es: "Cebolla", name_ca: "Ceba", name_en: "Onion" }),
    grocery("tomate triturado", { name_es: "Tomate triturado", name_ca: "Tomàquet triturat", name_en: "Crushed tomatoes" }),
  ]);

  it.each(["Cebolla", "Ceba", "Onion", "cebolla", "  CEBOLLA  "])("resolves %s to the one row", (typed) => {
    expect(resolveKey(typed, vocabulary)).toBe("cebolla");
  });

  it("strips diacritics, because phone keyboards make that a real pair", () => {
    expect(resolveKey("tomaquet triturat", vocabulary)).toBe("tomate triturado");
  });

  it("collapses whitespace the way the server does", () => {
    expect(resolveKey("tomate    triturado", vocabulary)).toBe("tomate triturado");
  });

  it("answers null for something the vocabulary does not know", () => {
    // Not a failure: `bolsas de basura` merges on its own name, exactly as
    // everything did before any of this existed.
    expect(resolveKey("bolsas de basura", vocabulary)).toBeNull();
  });

  it("does not match on a prefix — that is the autocomplete's job, not this one", () => {
    // A wrong answer here silently merges two ingredients on a shopping list.
    expect(resolveKey("cebolla tierna", vocabulary)).toBeNull();
  });
});

describe("groceryFor", () => {
  const vocabulary = byKey([grocery("cebolla", { name_es: "Cebolla", name_ca: "Ceba", name_en: "Onion", aisle: "produce" })]);

  it("uses the key the server resolved", () => {
    // The fix: a line typed as `Ceba` normalises to `ceba`, which is not a key.
    // Matching on the name alone is what put 87% of Catalan lines in `Otros`.
    expect(groceryFor(line("ceba", "cebolla"), vocabulary)?.aisle).toBe("produce");
  });

  it("falls back to the name, so lines written before the key existed still sort", () => {
    expect(groceryFor(line("cebolla"), vocabulary)?.aisle).toBe("produce");
  });
});

describe("displayName", () => {
  const vocabulary = byKey([grocery("cebolla", { name_es: "Cebolla", name_ca: "Ceba", name_en: "Onion" })]);

  it("reads a matched line in the reader's own language", () => {
    // The payoff for merging across languages: one line, two readers, each in
    // their own words.
    expect(displayName(line("ceba", "cebolla"), vocabulary, "es")).toBe("Cebolla");
    expect(displayName(line("ceba", "cebolla"), vocabulary, "ca")).toBe("Ceba");
  });

  it("keeps the typed words for anything unmatched", () => {
    expect(displayName(line("bolsas de basura"), vocabulary, "en")).toBe("bolsas de basura");
  });
});

describe("which freshly typed line is worth asking the model about", () => {
  const week = (...items: ShoppingListItem[]): MealPlan => ({
    id: "plan-1",
    kitchen_id: "k1",
    week_start: "2026-09-05",
    status: "planning",
    entries: [],
    items,
    created_by: null,
    created_at: "",
    updated_at: "",
  });
  const vocabulary = byKey([grocery("huevos", { aisle: "dairy_eggs" })]);

  it("is the line the typed words became, found by name — however they were typed", () => {
    const typed = line("papel de horno");

    expect(lineToClassify(week(typed), "  Papel de HORNO ", vocabulary)).toBe(typed);
  });

  it("is nothing when the server already gave it a key", () => {
    expect(lineToClassify(week(line("huevos", "huevos")), "huevos", vocabulary)).toBeNull();
  });

  it("is nothing when the vocabulary already files it by name — that answer is free", () => {
    expect(lineToClassify(week(line("huevos")), "huevos", vocabulary)).toBeNull();
  });

  it("is nothing when the typing only merged into a line already in the basket", () => {
    expect(lineToClassify(week({ ...line("papel de horno"), is_checked: true }), "papel de horno", vocabulary)).toBeNull();
  });
});

describe("the admin's ingredient list", () => {
  const seed = grocery("huevos", { name_ca: "Ous", name_en: "Eggs", aisle: "dairy_eggs", source: "seed", created_at: "2026-09-01T10:00:00+00:00" });
  const guess = grocery("kombucha", { aisle: "drinks", source: "ai", confirmed_at: null, created_at: "2026-09-24T10:00:00+00:00" });
  const vouched = grocery("kefir", { aisle: "dairy_eggs", source: "ai", confirmed_at: "2026-09-24T12:00:00+00:00", created_at: "2026-09-20T10:00:00+00:00" });
  const filed = grocery("qwerty", { source: "human", created_at: "2026-09-25T10:00:00+00:00" });
  const all = [seed, guess, vouched, filed];

  it("puts the newest first — the thing you came to look at is the one that just appeared", () => {
    expect(narrowVocabulary(all, "", null).map((i) => i.key)).toEqual(["qwerty", "kombucha", "kefir", "huevos"]);
  });

  it("narrows to one aisle", () => {
    expect(narrowVocabulary(all, "", "dairy_eggs").map((i) => i.key)).toEqual(["kefir", "huevos"]);
  });

  it("finds a row by any of its three names, accents and case aside", () => {
    expect(narrowVocabulary(all, "OUS", null)).toEqual([seed]);
  });

  it("calls only the parser's unvouched guesses 'to review'", () => {
    expect(all.filter(isUnreviewed)).toEqual([guess]);
    expect(narrowVocabulary(all, "", "unreviewed")).toEqual([guess]);
  });
});
