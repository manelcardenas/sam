import { describe, expect, it } from "vitest";

import {
  clearFilters,
  DEFAULT_SORT,
  EMPTY_FILTERS,
  fromSearchParams,
  isFiltered,
  reviewersOf,
  toQuery,
  toSearchParams,
  type FilterState,
} from "./RestaurantFilters";
import type { RestaurantDetail } from "@/lib/api-client";

function filters(overrides: Partial<FilterState> = {}): FilterState {
  return { ...EMPTY_FILTERS, ...overrides };
}

function roundTrip(state: FilterState): FilterState {
  return fromSearchParams(new URLSearchParams(toSearchParams(state)));
}

describe("toSearchParams / fromSearchParams round trip", () => {
  it("serialises nothing when nothing is filtered", () => {
    expect(toSearchParams(EMPTY_FILTERS)).toBe("");
    expect(roundTrip(EMPTY_FILTERS)).toEqual(EMPTY_FILTERS);
  });

  it("restores a full set of filters", () => {
    const state = filters({
      q: "ramen",
      cuisines: ["japanese", "korean"],
      priceLevels: [2, 3],
      reviewers: ["u-martina", "u-nel"],
      sort: "rating",
    });
    expect(roundTrip(state)).toEqual(state);
  });

  it("keeps several reviewers as repeated params", () => {
    const params = new URLSearchParams(toSearchParams(filters({ reviewers: ["u-a", "u-b"] })));
    expect(params.getAll("reviewer")).toEqual(["u-a", "u-b"]);
  });

  it("keeps multiple cuisines as repeated params, not one joined value", () => {
    const params = new URLSearchParams(toSearchParams(filters({ cuisines: ["italian", "thai"] })));
    expect(params.getAll("cuisine")).toEqual(["italian", "thai"]);
  });

  it("omits the default sort so the common URL stays clean", () => {
    expect(toSearchParams(filters({ sort: DEFAULT_SORT }))).toBe("");
    expect(toSearchParams(filters({ sort: "rating" }))).toBe("sort=rating");
  });

  it("trims the search term on the way out", () => {
    expect(toSearchParams(filters({ q: "  ramen  " }))).toBe("q=ramen");
  });

  it("treats a whitespace-only search as no search", () => {
    expect(toSearchParams(filters({ q: "   " }))).toBe("");
  });
});

describe("hostile URL input", () => {
  it("drops a non-numeric price instead of sending NaN to the API", () => {
    expect(fromSearchParams(new URLSearchParams("price=abc")).priceLevels).toEqual([]);
  });

  it("drops prices outside the 1–4 scale", () => {
    expect(fromSearchParams(new URLSearchParams("price=0&price=5&price=-1")).priceLevels).toEqual([]);
  });

  it("drops a fractional price", () => {
    expect(fromSearchParams(new URLSearchParams("price=2.5")).priceLevels).toEqual([]);
  });

  it("keeps the valid prices from a mixed list", () => {
    expect(fromSearchParams(new URLSearchParams("price=2&price=abc&price=9")).priceLevels).toEqual([2]);
  });

  it("falls back to the default sort rather than 422-ing the page", () => {
    expect(fromSearchParams(new URLSearchParams("sort=banana")).sort).toBe(DEFAULT_SORT);
  });

  it("drops the old ?mine=1 rather than guessing whose it was", () => {
    expect(fromSearchParams(new URLSearchParams("mine=1"))).toEqual(EMPTY_FILTERS);
  });

  it("survives a URL with nothing it recognises", () => {
    expect(fromSearchParams(new URLSearchParams("nonsense=1"))).toEqual(EMPTY_FILTERS);
  });
});

describe("sort is ordering, not filtering", () => {
  // The distinction the component's docstring insists on: sorting must not
  // flip the heading to "Matching", must not light up Clear, and must survive
  // a Clear.
  it("does not count as filtered", () => {
    expect(isFiltered(filters({ sort: "rating" }))).toBe(false);
  });

  it("survives clearing", () => {
    expect(clearFilters(filters({ q: "ramen", cuisines: ["thai"], sort: "rating" }))).toEqual(
      filters({ sort: "rating" }),
    );
  });

  it.each([
    ["a search term", filters({ q: "ramen" })],
    ["a cuisine", filters({ cuisines: ["thai"] })],
    ["a price", filters({ priceLevels: [2] })],
    ["a reviewer", filters({ reviewers: ["u-martina"] })],
  ])("%s does count as filtered", (_label, state) => {
    expect(isFiltered(state)).toBe(true);
  });

  it("does not count a whitespace-only search as filtered", () => {
    expect(isFiltered(filters({ q: "   " }))).toBe(false);
  });
});

describe("toQuery, the API-facing shape", () => {
  it("sends undefined rather than an empty search term", () => {
    expect(toQuery(EMPTY_FILTERS).q).toBeUndefined();
    expect(toQuery(filters({ q: "  " })).q).toBeUndefined();
  });

  it("trims the search term", () => {
    expect(toQuery(filters({ q: "  ramen " })).q).toBe("ramen");
  });
});

describe("reviewersOf, what 'Reviewed by' offers", () => {
  const MANEL = { id: "u-manel", display_name: "Manel" };
  const MARTINA = { id: "u-martina", display_name: "Martina" };
  const ALEX = { id: "u-alex", display_name: "Àlex" };

  function place(reviewers: { id: string; display_name: string }[]): RestaurantDetail {
    return { reviewers } as unknown as RestaurantDetail;
  }

  it("lists each reviewer once, you first, then by name", () => {
    const people = reviewersOf([place([MARTINA, MANEL]), place([ALEX, MARTINA])], "u-manel", "es");
    expect(people).toEqual([
      { id: "u-manel", name: "Manel" },
      { id: "u-alex", name: "Àlex" },
      { id: "u-martina", name: "Martina" },
    ]);
  });

  it("offers nothing when the only choice would select the whole list", () => {
    expect(reviewersOf([place([MANEL]), place([MANEL])], "u-manel", "es")).toEqual([]);
  });

  it("keeps a lone reviewer while unreviewed places exist, since that still narrows", () => {
    expect(reviewersOf([place([MANEL]), place([])], "u-manel", "es")).toEqual([{ id: "u-manel", name: "Manel" }]);
  });

  it("offers nothing for an empty archive", () => {
    expect(reviewersOf([], "u-manel", "es")).toEqual([]);
  });
});
