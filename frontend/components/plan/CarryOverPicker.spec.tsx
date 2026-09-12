import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CarryOverPicker } from "./CarryOverPicker";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import type { ShoppingListItem } from "@/lib/api-client";

/**
 * The picker shown inside the "Done shopping" confirmation.
 *
 * What matters here is not the markup but the two things that lose data if they
 * are wrong: that every row starts *on* (the caller seeds it, so these pin that
 * the component renders what it is given rather than inventing its own default),
 * and that toggling reports the right id.
 *
 * `fireEvent` rather than `user-event` — the latter is not a dependency and
 * `knip` exists to keep it that way.
 */

function line(id: string, name: string, extra: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    id,
    display_name: name,
    normalised_name: name.toLowerCase(),
    unit: null,
    total_amount: null,
    is_checked: false,
    is_manual: true,
    sources: [],
    created_by: null,
    created_by_name: null,
    ...extra,
  };
}

const ITEMS = [line("i-1", "Azúcar"), line("i-2", "Papel de cocina"), line("i-3", "Perejil")];

function setup(chosen: string[] = ITEMS.map((i) => i.id), items = ITEMS) {
  const onToggle = vi.fn();
  render(
    <LocaleProvider>
      <CarryOverPicker items={items} chosen={new Set(chosen)} onToggle={onToggle} />
    </LocaleProvider>,
  );
  return { onToggle };
}

const rowFor = (name: string) => screen.getByRole("checkbox", { name: new RegExp(name) });

describe("the carry-over picker", () => {
  it("lists every unbought line", () => {
    setup();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("counts them in the heading", () => {
    setup();
    expect(screen.getByText("3 things you didn't get")).toBeInTheDocument();
  });

  it("uses the singular for one", () => {
    setup(["i-1"], [ITEMS[0]]);
    expect(screen.getByText("1 thing you didn't get")).toBeInTheDocument();
  });

  it("renders every row ticked when the caller seeds them all", () => {
    setup();
    // The default that keeps the sugar: the usual reason a line is unbought is
    // that the shop was out of it.
    for (const item of ITEMS) expect(rowFor(item.display_name)).toHaveAttribute("aria-checked", "true");
  });

  it("renders a row unticked when the caller has dropped it", () => {
    setup(["i-1", "i-2"]);
    expect(rowFor("Perejil")).toHaveAttribute("aria-checked", "false");
    expect(rowFor("Azúcar")).toHaveAttribute("aria-checked", "true");
  });

  it("reports the id of the row you tap", () => {
    const { onToggle } = setup();
    fireEvent.click(rowFor("Papel de cocina"));
    expect(onToggle).toHaveBeenCalledWith("i-2");
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("reports a tap on an already-unticked row too", () => {
    // Toggling is symmetric — changing your mind back has to work.
    const { onToggle } = setup([]);
    fireEvent.click(rowFor("Azúcar"));
    expect(onToggle).toHaveBeenCalledWith("i-1");
  });

  it("shows an amount and unit when the line carries one", () => {
    setup(["i-9"], [line("i-9", "Lentejas", { total_amount: 500, unit: "g" })]);
    expect(screen.getByText("500 g")).toBeInTheDocument();
  });

  it("shows no amount for a line that has none", () => {
    // "Sal" is a real ingredient, not a zero — printing 0 would be a lie.
    setup();
    expect(screen.queryByText(/^0/)).not.toBeInTheDocument();
  });

  it("keeps every row a full touch target", () => {
    setup();
    for (const row of screen.getAllByRole("checkbox")) expect(row.className).toContain("min-h-11");
  });
});
