import { describe, expect, it } from "vitest";

import {
  INITIAL_STATE,
  PROFILE_TABS,
  fromQuery,
  toQuery,
  visibleTabs,
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
    const state: ProfileUrlState = { tab: "recipes", q: "lasaña", category: "comida", sort: "recent", year: null, shelf: null };
    expect(roundTrip(state)).toEqual(state);
  });

  it("restores a searched, re-sorted review list", () => {
    const state: ProfileUrlState = { tab: "reviews", q: "casa", category: null, sort: "score", year: null, shelf: null };
    expect(roundTrip(state)).toEqual(state);
  });

  it("keeps the default sort out of the URL", () => {
    expect(toQuery({ tab: "reviews", q: "", category: null, sort: "recent", year: null, shelf: null })).toBe("tab=reviews");
    expect(toQuery({ tab: "reviews", q: "", category: null, sort: "score", year: null, shelf: null })).toBe(
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
    expect(toQuery({ tab: "reviews", q: "", category: "postre", sort: "recent", year: null, shelf: null })).toBe("tab=reviews");
    expect(toQuery({ tab: "account", q: "", category: "postre", sort: "score", year: null, shelf: null })).toBe("tab=account");
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
    const searched: ProfileUrlState = { tab: "recipes", q: "pan", category: "comida", sort: "recent", year: null, shelf: null };
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

describe("the plans archive tab", () => {
  it("keeps /profile?tab=plans as the link to 'the archive'", () => {
    // Not to one particular year forever — a bookmark made in 2026 should still
    // open on the current year in 2027.
    expect(toQuery({ ...INITIAL_STATE, tab: "plans" })).toBe("tab=plans");
    expect(fromQuery(new URLSearchParams("tab=plans")).year).toBeNull();
  });

  it("restores a chosen year", () => {
    const state: ProfileUrlState = { ...INITIAL_STATE, tab: "plans", year: 2025 };
    expect(toQuery(state)).toBe("tab=plans&year=2025");
    expect(fromQuery(new URLSearchParams(toQuery(state)))).toEqual(state);
  });

  it.each(["banana", "25", "0", "12026", "1999", "2201", ""])("ignores an unusable year %j", (raw) => {
    // Rejected rather than clamped: a clamped year would show something other
    // than what the URL claims.
    expect(fromQuery(new URLSearchParams(`tab=plans&year=${raw}`)).year).toBeNull();
  });

  it("drops the year on every other tab", () => {
    // Same rule as `category` and `sort`: narrowing is scoped to the tab that
    // owns it, or switching tabs carries a filter with no visible cause.
    expect(fromQuery(new URLSearchParams("tab=reviews&year=2025")).year).toBeNull();
    expect(toQuery({ ...INITIAL_STATE, tab: "recipes", year: 2025 })).toBe("tab=recipes");
  });

  it("is dropped by withTab, like every other narrowing", () => {
    expect(withTab("plans").year).toBeNull();
  });
});

describe("the admin tab", () => {
  it("keeps its search and its shelf in the URL", () => {
    const state: ProfileUrlState = { ...INITIAL_STATE, tab: "admin", q: "kombu", shelf: "unreviewed" };

    expect(toQuery(state)).toBe("tab=admin&q=kombu&shelf=unreviewed");
    expect(fromQuery(new URLSearchParams(toQuery(state)))).toEqual(state);
  });

  it("ignores a shelf on any other tab, and a shelf that is not an aisle", () => {
    expect(fromQuery(new URLSearchParams("tab=recipes&shelf=drinks")).shelf).toBeNull();
    expect(fromQuery(new URLSearchParams("tab=admin&shelf=garden")).shelf).toBeNull();
  });

  it("is only among the visible tabs for an admin", () => {
    expect(visibleTabs(true)).toContain("admin");
    expect(visibleTabs(false)).not.toContain("admin");
    expect(visibleTabs(false)).toHaveLength(PROFILE_TABS.length - 1);
  });
});
