import { describe, expect, it } from "vitest";

import {
  INITIAL_STATE,
  PROFILE_TABS,
  fromQuery,
  toQuery,
  withTab,
  type ProfileUrlState,
} from "./profile-url";

function roundTrip(state: ProfileUrlState): ProfileUrlState {
  return fromQuery(new URLSearchParams(toQuery(state)));
}

describe("toQuery / fromQuery round trip", () => {
  it("renders the hub as a bare URL", () => {
    expect(toQuery(INITIAL_STATE)).toBe("");
    expect(roundTrip(INITIAL_STATE)).toEqual(INITIAL_STATE);
  });

  it("restores every tab", () => {
    for (const tab of PROFILE_TABS) {
      expect(roundTrip({ ...INITIAL_STATE, tab })).toEqual({ ...INITIAL_STATE, tab });
    }
  });

  it("restores a searched recipe list", () => {
    const state: ProfileUrlState = { tab: "recipes", q: "lasaña", category: "comida", sort: "recent" };
    expect(roundTrip(state)).toEqual(state);
  });

  it("restores a searched, re-sorted review list", () => {
    const state: ProfileUrlState = { tab: "reviews", q: "casa", category: null, sort: "score" };
    expect(roundTrip(state)).toEqual(state);
  });

  it("keeps the default sort out of the URL", () => {
    expect(toQuery({ tab: "reviews", q: "", category: null, sort: "recent" })).toBe("tab=reviews");
    expect(toQuery({ tab: "reviews", q: "", category: null, sort: "score" })).toBe(
      "tab=reviews&sort=score",
    );
  });

  it("trims the search term rather than encoding whitespace", () => {
    expect(toQuery({ ...INITIAL_STATE, tab: "recipes", q: "  pan  " })).toBe("tab=recipes&q=pan");
    expect(roundTrip({ ...INITIAL_STATE, tab: "recipes", q: "  pan  " }).q).toBe("pan");
  });
});

describe("narrowing is scoped to the tab that owns it", () => {
  it("does not write a category on tabs that have no categories", () => {
    expect(toQuery({ tab: "reviews", q: "", category: "postre", sort: "recent" })).toBe("tab=reviews");
    expect(toQuery({ tab: "account", q: "", category: "postre", sort: "score" })).toBe("tab=account");
  });

  it("does not write a search on the hub or the account tab", () => {
    expect(toQuery({ ...INITIAL_STATE, tab: "overview", q: "pan" })).toBe("");
    expect(toQuery({ ...INITIAL_STATE, tab: "account", q: "pan" })).toBe("tab=account");
  });

  it("ignores a hand-edited category on the reviews tab", () => {
    expect(fromQuery(new URLSearchParams("tab=reviews&category=comida")).category).toBeNull();
  });

  it("ignores a hand-edited sort on the recipes tab", () => {
    expect(fromQuery(new URLSearchParams("tab=recipes&sort=score")).sort).toBe("recent");
  });
});

describe("guards against hand-edited URLs", () => {
  it("falls back to the hub for an unknown tab", () => {
    expect(fromQuery(new URLSearchParams("tab=nope"))).toEqual(INITIAL_STATE);
    expect(fromQuery(new URLSearchParams("tab="))).toEqual(INITIAL_STATE);
  });

  it("drops an unknown category rather than rendering an empty list", () => {
    expect(fromQuery(new URLSearchParams("tab=recipes&category=pizza")).category).toBeNull();
  });

  it("drops an unknown sort rather than passing it on", () => {
    expect(fromQuery(new URLSearchParams("tab=reviews&sort=sideways")).sort).toBe("recent");
  });

  it("reads an empty query string as the hub", () => {
    expect(fromQuery(new URLSearchParams(""))).toEqual(INITIAL_STATE);
  });
});

describe("withTab", () => {
  it("drops the previous tab's narrowing", () => {
    const searched: ProfileUrlState = { tab: "recipes", q: "pan", category: "comida", sort: "recent" };
    expect(withTab("reviews")).toEqual({ ...INITIAL_STATE, tab: "reviews" });
    // The search must not survive the switch, or the reviews list looks empty
    // for no visible reason.
    expect(withTab("reviews").q).toBe("");
    expect(searched.q).toBe("pan"); // and the caller's state is untouched
  });

  it("agrees with what a bare tab URL decodes to", () => {
    for (const tab of PROFILE_TABS) {
      expect(withTab(tab)).toEqual(fromQuery(new URLSearchParams(toQuery(withTab(tab)))));
    }
  });
});
