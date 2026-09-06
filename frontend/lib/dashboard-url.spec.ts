import { describe, expect, it } from "vitest";

import { fromQuery, toQuery, type DashboardUrlState } from "./dashboard-url";

function roundTrip(state: DashboardUrlState): DashboardUrlState {
  return fromQuery(new URLSearchParams(toQuery(state)));
}

describe("toQuery / fromQuery round trip", () => {
  it("restores the top-level category grid as a bare URL", () => {
    expect(toQuery({ view: "categories", category: null, recipeId: null })).toBe("");
    expect(roundTrip({ view: "categories", category: null, recipeId: null })).toEqual({
      view: "categories",
      category: null,
      recipeId: null,
    });
  });

  it("restores an open category", () => {
    expect(roundTrip({ view: "recipes", category: "comida", recipeId: null })).toEqual({
      view: "recipes",
      category: "comida",
      recipeId: null,
    });
  });

  it("restores an open recipe", () => {
    expect(roundTrip({ view: "detail", category: "postre", recipeId: "r1" })).toEqual({
      view: "detail",
      category: "postre",
      recipeId: "r1",
    });
  });

  it("restores the recipe editor", () => {
    expect(roundTrip({ view: "edit", category: "bebida", recipeId: "r1" })).toEqual({
      view: "edit",
      category: "bebida",
      recipeId: "r1",
    });
  });

  it("restores the add form, which belongs to no category", () => {
    expect(roundTrip({ view: "add", category: null, recipeId: null })).toEqual({
      view: "add",
      category: null,
      recipeId: null,
    });
  });
});

describe("category is carried so back lands where you came from", () => {
  it("keeps the category alongside an open recipe", () => {
    // Documented in dashboard-url.ts: without this, backing out of a recipe
    // drops you on the top-level grid instead of the list you opened it from.
    const params = new URLSearchParams(toQuery({ view: "detail", category: "comida", recipeId: "r1" }));
    expect(params.get("category")).toBe("comida");
    expect(params.get("recipe")).toBe("r1");
  });

  it("keeps it through the editor too", () => {
    const params = new URLSearchParams(toQuery({ view: "edit", category: "comida", recipeId: "r1" }));
    expect(params.get("category")).toBe("comida");
    expect(params.get("mode")).toBe("edit");
  });
});

describe("hostile and malformed URLs", () => {
  it("ignores a category outside the vocabulary", () => {
    // Hand-edited ?category=nonsense must degrade to the grid, not render an
    // empty category that looks like a bug.
    expect(fromQuery(new URLSearchParams("category=nonsense"))).toEqual({
      view: "categories",
      category: null,
      recipeId: null,
    });
  });

  it("keeps a valid recipe even when its category is junk", () => {
    // The recipe is real; only the breadcrumb is wrong. Dropping the recipe
    // too would lose more than the URL actually got wrong.
    expect(fromQuery(new URLSearchParams("category=nonsense&recipe=r1"))).toEqual({
      view: "detail",
      category: null,
      recipeId: "r1",
    });
  });

  it("lets mode=new win over a stale recipe id", () => {
    // ?recipe=r1&mode=new — the add form is not editing r1, so the id must
    // not leak into it.
    expect(fromQuery(new URLSearchParams("recipe=r1&mode=new"))).toEqual({
      view: "add",
      category: null,
      recipeId: null,
    });
  });

  it("keeps the category behind the add form", () => {
    // Unlike the recipe id, the category is still where you came from.
    expect(fromQuery(new URLSearchParams("category=comida&mode=new"))).toEqual({
      view: "add",
      category: "comida",
      recipeId: null,
    });
  });

  it("falls back to the category list when mode=edit names no recipe", () => {
    expect(fromQuery(new URLSearchParams("category=comida&mode=edit"))).toEqual({
      view: "recipes",
      category: "comida",
      recipeId: null,
    });
  });

  it("treats an unknown mode as plain detail", () => {
    expect(fromQuery(new URLSearchParams("recipe=r1&mode=banana"))).toEqual({
      view: "detail",
      category: null,
      recipeId: "r1",
    });
  });

  it("ignores an empty category rather than trusting it", () => {
    expect(fromQuery(new URLSearchParams("category="))).toEqual({
      view: "categories",
      category: null,
      recipeId: null,
    });
  });
});

describe("every real category survives a round trip", () => {
  // Guards against someone adding a FOOD_TYPE whose value needs URL escaping.
  it.each(["comida", "bebida", "postre", "aperitivo"] as const)("%s", (category) => {
    expect(roundTrip({ view: "recipes", category, recipeId: null })).toEqual({
      view: "recipes",
      category,
      recipeId: null,
    });
  });
});
