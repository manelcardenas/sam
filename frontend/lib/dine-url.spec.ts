import { describe, expect, it } from "vitest";

import { composeQuery, parseView, type DineView } from "./dine-url";

/**
 * These are round-trip tests: encode a state, decode it back, assert you got
 * the same state. That shape is worth more than testing the two directions
 * separately, because the bug this module can actually have is the two halves
 * disagreeing — and a round trip catches that without either side needing a
 * hand-written expected string.
 */

function roundTrip(view: DineView, placeId: string | null, filters = "") {
  return parseView(new URLSearchParams(composeQuery(filters, view, placeId)));
}

describe("composeQuery / parseView round trip", () => {
  it("restores the list view", () => {
    expect(roundTrip("list", null)).toEqual({ view: "list", placeId: null });
  });

  it("restores a restaurant detail", () => {
    expect(roundTrip("detail", "abc")).toEqual({ view: "detail", placeId: "abc" });
  });

  it("restores the restaurant editor", () => {
    expect(roundTrip("edit-restaurant", "abc")).toEqual({ view: "edit-restaurant", placeId: "abc" });
  });

  it("restores the review composer", () => {
    expect(roundTrip("add-review", "abc")).toEqual({ view: "add-review", placeId: "abc" });
  });

  it("restores the add-restaurant form, which has no place yet", () => {
    expect(roundTrip("add-restaurant", null)).toEqual({ view: "add-restaurant", placeId: null });
  });
});

describe("edit-review is deliberately not restorable", () => {
  // Documented in dine-url.ts: rebuilding the editor needs a review id we
  // don't put in the URL, and a URL naming a deleted review is worse than
  // landing on the restaurant.
  it("decodes to the restaurant instead of the editor", () => {
    expect(roundTrip("edit-review", "abc")).toEqual({ view: "detail", placeId: "abc" });
  });

  it("still writes a distinct query, so back dismisses the editor", () => {
    // The whole point of the entry: it must differ from plain detail, or the
    // history push collapses and the back gesture leaves the app.
    expect(composeQuery("", "edit-review", "abc")).not.toEqual(composeQuery("", "detail", "abc"));
  });
});

describe("filters and view share one query string", () => {
  const filters = "cuisine=italian&price=2&mine=1";

  it("keeps the filters when a place is open", () => {
    const params = new URLSearchParams(composeQuery(filters, "detail", "abc"));
    expect(params.get("cuisine")).toBe("italian");
    expect(params.get("price")).toBe("2");
    expect(params.get("mine")).toBe("1");
    expect(params.get("place")).toBe("abc");
  });

  it("keeps the filters behind the add-restaurant form", () => {
    // add-restaurant has no place, but backing out of it must land on the
    // filtered list you opened it from, not on everything.
    const params = new URLSearchParams(composeQuery(filters, "add-restaurant", null));
    expect(params.get("cuisine")).toBe("italian");
    expect(params.get("mode")).toBe("new");
  });

  it("preserves repeated params rather than collapsing them", () => {
    // ?cuisine=a&cuisine=b is two cuisines, not one. Round-tripping through a
    // plain object would silently drop one.
    const params = new URLSearchParams(composeQuery("cuisine=italian&cuisine=thai", "list", null));
    expect(params.getAll("cuisine")).toEqual(["italian", "thai"]);
  });
});

describe("hostile and malformed URLs", () => {
  it("ignores a place id on views that have none", () => {
    expect(new URLSearchParams(composeQuery("", "list", "abc")).has("place")).toBe(false);
    expect(new URLSearchParams(composeQuery("", "add-restaurant", "abc")).has("place")).toBe(false);
  });

  it("lets mode=new win over a stale place id", () => {
    // Hand-edited: ?place=abc&mode=new. The form is not about that restaurant,
    // so the place must be dropped, not carried into the new-restaurant flow.
    const parsed = parseView(new URLSearchParams("place=abc&mode=new"));
    expect(parsed).toEqual({ view: "add-restaurant", placeId: null });
  });

  it("falls back to the list when a mode names no place", () => {
    expect(parseView(new URLSearchParams("mode=edit"))).toEqual({ view: "list", placeId: null });
    expect(parseView(new URLSearchParams("mode=review"))).toEqual({ view: "list", placeId: null });
  });

  it("treats an unknown mode as plain detail", () => {
    expect(parseView(new URLSearchParams("place=abc&mode=banana"))).toEqual({
      view: "detail",
      placeId: "abc",
    });
  });

  it("ignores filters it does not recognise", () => {
    expect(parseView(new URLSearchParams("cuisine=italian&nonsense=1"))).toEqual({
      view: "list",
      placeId: null,
    });
  });
});
