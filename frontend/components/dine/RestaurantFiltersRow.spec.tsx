import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EMPTY_FILTERS, RestaurantFilters, type FilterState } from "./RestaurantFilters";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";

/**
 * The rendered row: people and cuisines as labelled dropdowns, price as chips.
 * The pure URL/query logic is covered in `RestaurantFilters.spec.ts`.
 */

const CUISINES = [
  { name: "Spanish", count: 4 },
  { name: "Chinese", count: 2 },
  { name: "Italian", count: 1 },
];

function setup(value: Partial<FilterState> = {}, cuisines = CUISINES) {
  const onChange = vi.fn();
  render(
    <LocaleProvider>
      <RestaurantFilters
        value={{ ...EMPTY_FILTERS, ...value }}
        cuisines={cuisines}
        priceLevels={[1, 2]}
        reviewers={[
          { id: "u-manel", name: "Manel" },
          { id: "u-martina", name: "Martina" },
        ]}
        currentUserId="u-manel"
        onChange={onChange}
        resultCount={3}
        busy={false}
      />
    </LocaleProvider>,
  );
  return { onChange };
}

const cuisineTrigger = () => screen.getByRole("button", { name: /Cuisine/ });

describe("the cuisine dropdown", () => {
  it("replaces the row of cuisine chips with one labelled control", () => {
    setup();
    expect(cuisineTrigger()).toBeInTheDocument();
    // Collapsed: no cuisine is a button of its own any more.
    expect(screen.queryByRole("button", { name: /Spanish/ })).not.toBeInTheDocument();
  });

  it("lists cuisines most-used first, each with how many places it has", () => {
    setup();
    fireEvent.click(cuisineTrigger());

    // Scoped: the sort control beside it is a listbox of options too.
    const options = within(screen.getByRole("listbox", { name: "Cuisine" })).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Spanish4", "Chinese2", "Italian1"]);
  });

  it("picks a cuisine by its key, not its translated name", () => {
    const { onChange } = setup({ cuisines: ["Chinese"] });
    fireEvent.click(cuisineTrigger());
    fireEvent.click(screen.getByRole("option", { name: /Spanish/ }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cuisines: ["Chinese", "Spanish"] }));
  });

  it("names the one cuisine picked", () => {
    setup({ cuisines: ["Chinese"] });
    expect(cuisineTrigger()).toHaveTextContent("Chinese");
  });

  it("counts once several are picked", () => {
    setup({ cuisines: ["Chinese", "Spanish"] });
    expect(cuisineTrigger()).toHaveTextContent("2 cuisines");
  });

  it("never grows a search box, even at a dozen cuisines", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `Cuisine${i}`, count: 1 }));
    setup({}, many);
    fireEvent.click(cuisineTrigger());

    // Only the restaurant-name search box: twelve short names are quicker to
    // read than to type, unlike a directory of people.
    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
  });

  it("is absent when no cuisine is in use", () => {
    setup({}, []);
    expect(screen.queryByRole("button", { name: /Cuisine/ })).not.toBeInTheDocument();
  });
});

describe("the rest of the row", () => {
  it("leads with Reviewed by and keeps price as chips", () => {
    setup();
    expect(screen.getByRole("button", { name: /Reviewed by/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Price level 1 of 4/ })).toBeInTheDocument();
  });
});
