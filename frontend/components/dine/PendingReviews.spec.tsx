import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PendingReviews } from "./PendingReviews";
import type { RestaurantDetail } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";

function place(id: string): RestaurantDetail {
  return { id, name: `Place ${id}`, cuisines: [], created_at: "2026-09-20T10:00:00Z" } as unknown as RestaurantDetail;
}

function setup(restaurants: RestaurantDetail[]) {
  const onReview = vi.fn();
  render(
    <LocaleProvider>
      <PendingReviews restaurants={restaurants} onReview={onReview} />
    </LocaleProvider>,
  );
  return { onReview };
}

describe("PendingReviews", () => {
  it("renders nothing when nothing is owed", () => {
    const { container } = render(
      <LocaleProvider>
        <PendingReviews restaurants={[]} onReview={vi.fn()} />
      </LocaleProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says how many are owed", () => {
    setup([place("a"), place("b")]);
    expect(screen.getByRole("heading", { name: "You owe 2 reviews" })).toBeInTheDocument();
  });

  it("goes straight to the review from each row", () => {
    const { onReview } = setup([place("a")]);
    fireEvent.click(screen.getByRole("button", { name: "Review Place a" }));
    expect(onReview).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("folds past three so it never buries the list, and unfolds on request", () => {
    setup([place("a"), place("b"), place("c"), place("d"), place("e")]);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Show fewer" })).toBeInTheDocument();
  });

  it("offers no way to dismiss it — reviewing is what clears it", () => {
    setup([place("a")]);
    expect(screen.queryByRole("button", { name: /close|dismiss/i })).not.toBeInTheDocument();
  });
});
