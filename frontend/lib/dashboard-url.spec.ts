import { describe, expect, it } from "vitest";

import { INITIAL_STATE, fromQuery, toQuery, type DashboardUrlState } from "./dashboard-url";

function roundTrip(state: DashboardUrlState): DashboardUrlState {
  return fromQuery(new URLSearchParams(toQuery(state)));
}

describe("toQuery / fromQuery round trip", () => {
  it("renders the unfiltered list as a bare URL", () => {
    expect(toQuery(INITIAL_STATE)).toBe("");
    expect(roundTrip(INITIAL_STATE)).toEqual(INITIAL_STATE);
  });

  it("restores a category filter", () => {
    const state: DashboardUrlState = { view: "list", category: "comida", recipeId: null, q: "" };
    expect(toQuery(state)).toBe("category=comida");
    expect(roundTrip(state)).toEqual(state);
  });

  it("restores a search", () => {
    const state: DashboardUrlState = { view: "list", category: null, recipeId: null, q: "lasaña" };
    expect(roundTrip(state)).toEqual(state);
  });

  it("restores a search and a category together", () => {
    const state: DashboardUrlState = { view: "list", category: "postre", recipeId: null, q: "tarta" };
    expect(roundTrip(state)).toEqual(state);
  });

  it("restores an open recipe", () => {
    const state: DashboardUrlState = { view: "detail", category: "postre", recipeId: "r1", q: "" };
    expect(roundTrip(state)).toEqual(state);
  });

  it("restores an open recipe reached without a category filter", () => {
    const state: DashboardUrlState = { view: "detail", category: null, recipeId: "r1", q: "" };
    expect(roundTrip(state)).toEqual(state);
  });

  it("restores the editor", () => {
    const state: DashboardUrlState = { view: "edit", category: "comida", recipeId: "r7", q: "" };
    expect(roundTrip(state)).toEqual(state);
  });

  it("restores the create form", () => {
    const state: DashboardUrlState = { view: "add", category: null, recipeId: null, q: "" };
    expect(toQuery(state)).toBe("mode=new");
    expect(roundTrip(state)).toEqual(state);
  });

  it("trims the search term rather than encoding whitespace", () => {
    expect(toQuery({ ...INITIAL_STATE, q: "  pan  " })).toBe("q=pan");
    expect(roundTrip({ ...INITIAL_STATE, q: "  pan  " }).q).toBe("pan");
  });
});

describe("category is a filter, not a view", () => {
  it("keeps the category alongside an open recipe, so backing out returns to the same list", () => {
    expect(fromQuery(new URLSearchParams("category=comida&recipe=r1"))).toEqual({
      view: "detail",
      category: "comida",
      recipeId: "r1",
      q: "",
    });
  });

  it("reads a lone category as the list, not as a separate view", () => {
    expect(fromQuery(new URLSearchParams("category=bebida")).view).toBe("list");
  });

  it("reads a bare URL as the list, not as a grid", () => {
    expect(fromQuery(new URLSearchParams("")).view).toBe("list");
  });
});

describe("the search term does not follow you out of the list", () => {
  it("is dropped on the way into a recipe", () => {
    // The list is re-narrowed by the history entry you came from, not by
    // carrying the term through the detail view's URL — where a refresh would
    // otherwise show a filtered list behind a recipe that may not match it.
    expect(toQuery({ view: "detail", category: null, recipeId: "r1", q: "pan" })).toBe("recipe=r1");
    expect(fromQuery(new URLSearchParams("recipe=r1&q=pan")).q).toBe("");
  });

  it("is dropped on the way into the create form", () => {
    expect(toQuery({ view: "add", category: "comida", recipeId: null, q: "pan" })).toBe("mode=new");
    expect(fromQuery(new URLSearchParams("mode=new&q=pan")).q).toBe("");
  });
});

describe("guards against hand-edited URLs", () => {
  it("drops an unknown category rather than rendering an empty list", () => {
    expect(fromQuery(new URLSearchParams("category=pizza")).category).toBeNull();
    expect(fromQuery(new URLSearchParams("category=")).category).toBeNull();
  });

  it("keeps an unknown category out of an open recipe's state too", () => {
    expect(fromQuery(new URLSearchParams("category=pizza&recipe=r1"))).toEqual({
      view: "detail",
      category: null,
      recipeId: "r1",
      q: "",
    });
  });

  it("treats an unrecognised mode as a plain view", () => {
    expect(fromQuery(new URLSearchParams("recipe=r1&mode=sideways")).view).toBe("detail");
    expect(fromQuery(new URLSearchParams("mode=sideways")).view).toBe("list");
  });

  it("ignores ?mode=edit with no recipe, which cannot be rendered", () => {
    expect(fromQuery(new URLSearchParams("mode=edit"))).toEqual(INITIAL_STATE);
  });

  it("lets mode=new win over a recipe id, matching what the page renders", () => {
    expect(fromQuery(new URLSearchParams("mode=new&recipe=r1")).view).toBe("add");
    expect(fromQuery(new URLSearchParams("mode=new&recipe=r1")).recipeId).toBeNull();
  });
});
