import { fireEvent, render, screen } from "@testing-library/react";
import { BookOpen, CalendarDays, ListChecks, Settings } from "lucide-react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { SegmentedControl } from "./SegmentedControl";

/**
 * Layout (which labels show at 360 px) is checked in a real browser by
 * e2e/copy-fits.e2e.ts; jsdom has no layout. This covers what jsdom can:
 * names, selection state and keys.
 */

describe("SegmentedControl", () => {
  it("keeps every segment's name while its label is collapsed to the icon", () => {
    render(
      <SegmentedControl
        label="View"
        value="calendar"
        onChange={() => undefined}
        segments={[
          { value: "calendar", label: "The week", icon: CalendarDays },
          { value: "list", label: "Shopping list", icon: ListChecks, badge: 3 },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "The week" })).toHaveAttribute("aria-current", "page");
    // The collapsed one: its label is sr-only, so it is still the accessible name.
    const list = screen.getByRole("button", { name: /Shopping list/ });
    expect(list).not.toHaveAttribute("aria-current");
    expect(list).toHaveAttribute("title", "Shopping list");
    expect(list).toHaveTextContent("3");
  });

  it("as a tablist, arrow keys move the selection and the focus with it", () => {
    function Tabs() {
      const [tab, setTab] = useState<"recipes" | "account">("recipes");
      return (
        <SegmentedControl
          role="tablist"
          idPrefix="t"
          label="Sections"
          value={tab}
          onChange={setTab}
          segments={[
            { value: "recipes", label: "Recipes", icon: BookOpen, controls: "p-recipes" },
            { value: "account", label: "Account", icon: Settings, controls: "p-account" },
          ]}
        />
      );
    }
    render(<Tabs />);

    const recipes = screen.getByRole("tab", { name: "Recipes" });
    expect(recipes).toHaveAttribute("aria-selected", "true");
    expect(recipes).toHaveAttribute("aria-controls", "p-recipes");
    expect(screen.getByRole("tab", { name: "Account" })).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(recipes, { key: "ArrowRight" });

    const account = screen.getByRole("tab", { name: "Account" });
    expect(account).toHaveAttribute("aria-selected", "true");
    expect(account).toHaveFocus();
  });

  it("clicking a segment reports it", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="View"
        value="calendar"
        onChange={onChange}
        segments={[
          { value: "calendar", label: "The week", icon: CalendarDays },
          { value: "list", label: "Shopping list", icon: ListChecks },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Shopping list" }));

    expect(onChange).toHaveBeenCalledWith("list");
  });
});
