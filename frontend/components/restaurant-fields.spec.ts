import { describe, expect, it } from "vitest";

import { formatDistance, matchCuisines } from "./restaurant-fields";
import type { Cuisine } from "@/lib/api-client";

const OPTIONS = ["Spanish", "Italian", "Mexican", "American", "Vegan/Vegetarian"].map((name) => ({ id: name, name })) as Cuisine[];

describe("matchCuisines", () => {
  it("matches a tag that is the cuisine's own name", () => {
    expect(matchCuisines(["italian"], OPTIONS)).toEqual(["Italian"]);
  });

  it("matches the unambiguous aliases real places carry", () => {
    expect(matchCuisines(["tapas"], OPTIONS)).toEqual(["Spanish"]);
    expect(matchCuisines(["tex-mex"], OPTIONS)).toEqual(["Mexican"]);
    expect(matchCuisines(["burger", "sandwich"], OPTIONS)).toEqual(["American"]);
    expect(matchCuisines(["vegan"], OPTIONS)).toEqual(["Vegan/Vegetarian"]);
  });

  it("drops what it cannot place rather than guessing", () => {
    expect(matchCuisines(["ice cream", "coffee_shop", "asian"], OPTIONS)).toEqual([]);
  });

  it("lists each cuisine once, in vocabulary order", () => {
    expect(matchCuisines(["pizza", "pasta", "spanish"], OPTIONS)).toEqual(["Spanish", "Italian"]);
  });
});

describe("formatDistance", () => {
  it("uses metres under a kilometre and one decimal above", () => {
    expect(formatDistance(77)).toBe("77 m");
    expect(formatDistance(1430)).toBe("1.4 km");
  });
});
