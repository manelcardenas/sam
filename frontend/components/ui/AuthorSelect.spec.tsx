import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AuthorSelect } from "./AuthorSelect";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import type { RecipeAuthor } from "@/lib/recipe-filters";

/**
 * The behaviour a multi-select has to get right, and that a row of chips got for
 * free by not having any: staying open while you pick several people, closing on
 * Escape *without* closing the sheet behind it, and saying what it filters on
 * before you open it.
 *
 * `fireEvent` rather than `user-event`: the latter is not a dependency of this
 * project and `knip` exists to keep it that way. Nothing here needs a full
 * pointer sequence.
 */

const PEOPLE: RecipeAuthor[] = [
  { id: "u-manel", name: "Manel" },
  { id: "u-martina", name: "Martina" },
  { id: "u-alex", name: "Àlex" },
];

function setup(selected: string[] = [], authors = PEOPLE) {
  const onChange = vi.fn();
  render(
    <LocaleProvider>
      <AuthorSelect label="Created by" authors={authors} selected={selected} onChange={onChange} currentUserId="u-manel" />
    </LocaleProvider>,
  );
  return { onChange };
}

const trigger = () => screen.getByRole("button", { name: /Created by/ });
const open = () => fireEvent.click(trigger());
const option = (name: RegExp) => screen.getByRole("option", { name });

describe("the trigger", () => {
  it("names what it filters on before you open it", () => {
    setup();
    // The whole point of this over a row of bare name chips: the row introduces
    // itself instead of being discovered by accident.
    expect(trigger()).toHaveTextContent("Created by");
  });

  it("shows the one name when one person is picked, not a count of one", () => {
    setup(["u-martina"]);
    expect(trigger()).toHaveTextContent("Martina");
  });

  it("shows a count once names stop fitting", () => {
    setup(["u-martina", "u-alex"]);
    expect(trigger()).toHaveTextContent("2 people");
    expect(trigger()).not.toHaveTextContent("Martina");
  });

  it("keeps saying 'Created by' while in use", () => {
    // A control that swaps its label for its value stops saying what it does at
    // exactly the moment a reader needs telling.
    setup(["u-martina"]);
    expect(trigger()).toHaveTextContent("Created by");
  });

  it("is collapsed until opened", () => {
    setup();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("opens and closes on its own trigger", () => {
    setup();
    open();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    open();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("choosing people", () => {
  it("lists everyone as a multi-selectable option", () => {
    setup();
    open();

    expect(screen.getByRole("listbox")).toHaveAttribute("aria-multiselectable", "true");
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("marks who you are, so you are not hunting for your own name", () => {
    setup();
    open();

    expect(within(option(/Manel/)).getByText("You")).toBeInTheDocument();
  });

  it("adds a person when picked", () => {
    const { onChange } = setup();
    open();
    fireEvent.click(option(/Martina/));

    expect(onChange).toHaveBeenCalledWith(["u-martina"]);
  });

  it("removes a person already picked", () => {
    const { onChange } = setup(["u-martina", "u-alex"]);
    open();
    fireEvent.click(option(/Martina/));

    expect(onChange).toHaveBeenCalledWith(["u-alex"]);
  });

  it("stays open after a pick, because choosing three people is one task", () => {
    // The failure this guards: closing on select turns "Manel and Martina" into
    // two open-scroll-tap round trips.
    setup();
    open();
    fireEvent.click(option(/Martina/));

    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("reports selection through aria, not only through colour", () => {
    setup(["u-martina"]);
    open();

    expect(option(/Martina/)).toHaveAttribute("aria-selected", "true");
    expect(option(/Àlex/)).toHaveAttribute("aria-selected", "false");
  });
});

describe("clearing", () => {
  it("offers Clear all only when something is selected", () => {
    setup();
    open();
    expect(screen.queryByText("Clear all")).not.toBeInTheDocument();
  });

  it("empties the selection in one tap", () => {
    const { onChange } = setup(["u-martina", "u-alex"]);
    open();
    fireEvent.click(screen.getByText("Clear all"));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("says how many are selected", () => {
    setup(["u-martina", "u-alex"]);
    open();

    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });
});

describe("searching, for a long list", () => {
  const MANY: RecipeAuthor[] = Array.from({ length: 9 }, (_, i) => ({ id: `u-${i}`, name: `Person ${i}` }));

  it("stays out of the way while the list is short enough to read", () => {
    setup([], PEOPLE);
    open();

    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("appears once the list is long enough to scan", () => {
    setup([], MANY);
    open();

    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("narrows the options as you type", () => {
    setup([], MANY);
    open();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Person 3" } });

    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("matches regardless of case", () => {
    setup([], MANY);
    open();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "PERSON 3" } });

    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("says so rather than showing an empty panel when nobody matches", () => {
    setup([], MANY);
    open();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });

    expect(screen.getByText("No one matches that.")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("forgets the search when reopened, so the list is never mysteriously short", () => {
    setup([], MANY);
    open();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Person 3" } });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    open();

    expect(screen.getAllByRole("option")).toHaveLength(9);
  });
});

describe("keyboard and focus", () => {
  it("closes on Escape and puts focus back on the trigger", () => {
    setup();
    open();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("does not let Escape reach the sheet it may be sitting inside", () => {
    // The panel opens *within* the planner's slot sheet, which closes itself on
    // a document-level Escape. Without the capture-phase stop, one press shuts
    // both and the user loses the slot they were editing.
    const sheetWouldClose = vi.fn();
    document.addEventListener("keydown", sheetWouldClose);
    setup();
    open();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    document.removeEventListener("keydown", sheetWouldClose);

    expect(sheetWouldClose).not.toHaveBeenCalled();
  });

  it("walks the options with the arrow keys", () => {
    setup();
    open();
    const list = screen.getByRole("listbox");

    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(option(/Manel/)).toHaveFocus();

    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(option(/Martina/)).toHaveFocus();
  });

  it("wraps rather than dead-ending at the last option", () => {
    setup();
    open();
    const list = screen.getByRole("listbox");

    fireEvent.keyDown(list, { key: "End" });
    expect(option(/Àlex/)).toHaveFocus();

    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(option(/Manel/)).toHaveFocus();
  });

  it("jumps to the first option with Home", () => {
    setup();
    open();
    const list = screen.getByRole("listbox");

    fireEvent.keyDown(list, { key: "End" });
    fireEvent.keyDown(list, { key: "Home" });
    expect(option(/Manel/)).toHaveFocus();
  });
});
