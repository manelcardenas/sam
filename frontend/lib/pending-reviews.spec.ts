import { describe, expect, it } from "vitest";

import type { RestaurantDetail } from "@/lib/api-client";
import { awaitingMyReview, isAwaitingMyReview } from "./pending-reviews";

const ME = "u-me";

function place(overrides: Partial<RestaurantDetail>): RestaurantDetail {
  return { id: "r", name: "R", created_by: ME, created_at: "2026-09-01T00:00:00Z", reviewers: [], ...overrides } as RestaurantDetail;
}

describe("awaitingMyReview", () => {
  it("is a place you added and nobody reviewed", () => {
    expect(isAwaitingMyReview(place({}), ME)).toBe(true);
  });

  it("still counts when someone else reviewed it — their review is not yours", () => {
    expect(isAwaitingMyReview(place({ reviewers: [{ id: "u-martina", display_name: "Martina" }] }), ME)).toBe(true);
  });

  it("stops once you have reviewed it", () => {
    expect(isAwaitingMyReview(place({ reviewers: [{ id: ME, display_name: "Me" }] }), ME)).toBe(false);
  });

  it("is never someone else's place", () => {
    expect(isAwaitingMyReview(place({ created_by: "u-martina" }), ME)).toBe(false);
  });

  it("is nothing before the user is known", () => {
    expect(awaitingMyReview([place({})], "")).toEqual([]);
  });

  it("lists the newest first", () => {
    const older = place({ id: "old", created_at: "2026-07-01T00:00:00Z" });
    const newer = place({ id: "new", created_at: "2026-09-01T00:00:00Z" });
    expect(awaitingMyReview([older, newer], ME).map((r) => r.id)).toEqual(["new", "old"]);
  });
});
