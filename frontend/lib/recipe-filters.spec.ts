import { describe, expect, it } from "vitest";

import type { Recipe } from "@/lib/api-client";
import {
  NO_FILTERS,
  authorsOf,
  categoriesOf,
  filterRecipes,
  isNarrowed,
  toggleAuthor,
  type RecipeFilterState,
} from "./recipe-filters";

function recipe(over: Partial<Recipe> & { title: string }): Recipe {
  return {
    id: over.title,
    instructions: null,
    ingredients: { servings: 2, items: [] },
    food_type: "comida",
    source_url: null,
    prep_time_minutes: null,
    cook_time_minutes: null,
    created_by: "u-manel",
    created_by_name: "Manel",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

const MANEL = { created_by: "u-manel", created_by_name: "Manel" };
const MARTINA = { created_by: "u-martina", created_by_name: "Martina" };
const ALEX = { created_by: "u-alex", created_by_name: "Àlex" };

describe("authorsOf", () => {
  it("returns each person once, however many recipes they wrote", () => {
    const authors = authorsOf(
      [recipe({ title: "a", ...MANEL }), recipe({ title: "b", ...MANEL }), recipe({ title: "c", ...MARTINA })],
      "u-manel",
      "en",
    );

    expect(authors).toEqual([
      { id: "u-manel", name: "Manel" },
      { id: "u-martina", name: "Martina" },
    ]);
  });

  it("puts you first, wherever your name falls alphabetically", () => {
    // "Manel" sorts after "Àlex" and before "Martina", so a plain sort would
    // bury the chip you reach for most in the middle of a scrolling row.
    const authors = authorsOf(
      [recipe({ title: "a", ...MARTINA }), recipe({ title: "b", ...ALEX }), recipe({ title: "c", ...MANEL })],
      "u-manel",
      "en",
    );

    expect(authors.map((a) => a.name)).toEqual(["Manel", "Àlex", "Martina"]);
  });

  it("sorts accented names where a reader expects, not after Z", () => {
    const authors = authorsOf(
      [recipe({ title: "a", ...MARTINA }), recipe({ title: "b", ...ALEX })],
      null,
      "es",
    );

    expect(authors.map((a) => a.name)).toEqual(["Àlex", "Martina"]);
  });

  it("leaves out authors with no display name, because a chip needs a label", () => {
    const authors = authorsOf(
      [recipe({ title: "a", ...MANEL }), recipe({ title: "b", created_by: "u-ghost", created_by_name: null })],
      "u-manel",
      "en",
    );

    expect(authors).toEqual([{ id: "u-manel", name: "Manel" }]);
  });

  it("offers nobody for an empty collection", () => {
    expect(authorsOf([], "u-manel", "en")).toEqual([]);
  });

  it("works when you are signed out or are not one of the authors", () => {
    const authors = authorsOf([recipe({ title: "a", ...MARTINA }), recipe({ title: "b", ...ALEX })], null, "en");

    expect(authors.map((a) => a.name)).toEqual(["Àlex", "Martina"]);
  });
});

describe("categoriesOf", () => {
  it("offers only categories something is actually filed under", () => {
    // The Bebida rule: a chip that can only ever return an empty list is a dead
    // end, so it is not drawn at all.
    const categories = categoriesOf([recipe({ title: "a", food_type: "comida" }), recipe({ title: "b", food_type: "postre" })]);

    expect(categories.map((c) => c.value)).toEqual(["comida", "postre"]);
  });

  it("keeps a stable order rather than reshuffling as the collection grows", () => {
    const many = [recipe({ title: "a", food_type: "postre" }), recipe({ title: "b", food_type: "comida" }), recipe({ title: "c", food_type: "comida" })];

    // FOOD_TYPES order, not frequency: a row that reorders itself when you add a
    // recipe defeats the muscle memory that makes chips fast.
    expect(categoriesOf(many).map((c) => c.value)).toEqual(["comida", "postre"]);
  });

  it("offers nothing for an empty collection", () => {
    expect(categoriesOf([])).toEqual([]);
  });
});

describe("filterRecipes", () => {
  const COLLECTION = [
    recipe({ title: "Lentejas", food_type: "comida", ...MANEL }),
    recipe({ title: "Tarta de manzana", food_type: "postre", ...MANEL }),
    recipe({ title: "Hummus", food_type: "aperitivo", ...MARTINA }),
    recipe({ title: "Tarta de queso", food_type: "postre", ...MARTINA }),
  ];
  const titles = (state: Partial<RecipeFilterState>) =>
    filterRecipes(COLLECTION, { ...NO_FILTERS, ...state }).map((r) => r.title);

  it("returns everything when nothing is set", () => {
    expect(titles({})).toHaveLength(4);
  });

  it("narrows by category", () => {
    expect(titles({ category: "postre" })).toEqual(["Tarta de manzana", "Tarta de queso"]);
  });

  it("narrows by author", () => {
    expect(titles({ authors: ["u-martina"] })).toEqual(["Hummus", "Tarta de queso"]);
  });

  it("ORs several authors rather than intersecting them", () => {
    // The whole point of multi-select: nothing is written by two people, so
    // intersecting would always return an empty list.
    expect(titles({ authors: ["u-manel", "u-martina"] })).toHaveLength(4);
  });

  it("treats no author as anyone, not as nobody", () => {
    expect(titles({ authors: [] })).toHaveLength(4);
  });

  it("ANDs across kinds", () => {
    expect(titles({ category: "postre", authors: ["u-manel"] })).toEqual(["Tarta de manzana"]);
  });

  it("searches case-insensitively on the title", () => {
    expect(titles({ q: "TARTA" })).toEqual(["Tarta de manzana", "Tarta de queso"]);
  });

  it("ignores surrounding whitespace in the search term", () => {
    expect(titles({ q: "  hummus  " })).toEqual(["Hummus"]);
  });

  it("treats a whitespace-only search as no search", () => {
    expect(titles({ q: "   " })).toHaveLength(4);
  });

  it("combines all three", () => {
    expect(titles({ q: "tarta", category: "postre", authors: ["u-martina"] })).toEqual(["Tarta de queso"]);
  });

  it("returns an empty list rather than everything when nothing matches", () => {
    expect(titles({ q: "paella" })).toEqual([]);
  });

  it("does not mutate the collection it is given", () => {
    const before = COLLECTION.map((r) => r.title);
    filterRecipes(COLLECTION, { ...NO_FILTERS, category: "postre" });
    expect(COLLECTION.map((r) => r.title)).toEqual(before);
  });
});

describe("isNarrowed", () => {
  it.each([
    [{}, false],
    [{ q: "x" }, true],
    [{ q: "   " }, false],
    [{ category: "postre" as const }, true],
    [{ authors: ["u-manel"] }, true],
    [{ authors: [] }, false],
  ])("%o → %s", (state, expected) => {
    expect(isNarrowed({ ...NO_FILTERS, ...state })).toBe(expected);
  });
});

describe("toggleAuthor", () => {
  it("adds someone not yet selected", () => {
    expect(toggleAuthor([], "u-manel")).toEqual(["u-manel"]);
  });

  it("removes someone already selected", () => {
    expect(toggleAuthor(["u-manel", "u-martina"], "u-manel")).toEqual(["u-martina"]);
  });

  it("never selects the same person twice", () => {
    expect(toggleAuthor(toggleAuthor([], "u-manel"), "u-manel")).toEqual([]);
  });

  it("does not mutate the array it is given", () => {
    const before = ["u-manel"];
    toggleAuthor(before, "u-martina");
    expect(before).toEqual(["u-manel"]);
  });
});
