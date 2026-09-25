import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GroceryAdminPanel } from "./GroceryAdminPanel";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { ApiError, apiClient, type GroceryItem } from "@/lib/api-client";
import type { Shelf } from "@/lib/profile-url";

/**
 * The admin's view of the shared vocabulary.
 *
 * What is worth pinning here is what the server cannot enforce on the admin's
 * behalf: the newest rows are the ones on top, a refused rename says why, and a
 * seeded row never offers a delete the next deploy would undo.
 */

function grocery(key: string, overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    key,
    name_es: key,
    name_ca: key,
    name_en: key,
    aisle: "other",
    is_pantry: false,
    default_unit: null,
    source: "ai",
    confirmed_at: null,
    created_at: "2026-09-20T10:00:00+00:00",
    ...overrides,
  };
}

const eggs = grocery("huevos", { name_es: "Huevos", name_ca: "Ous", name_en: "Eggs", aisle: "dairy_eggs", source: "seed", created_at: "2026-09-01T10:00:00+00:00" });
const kombucha = grocery("kombucha", { name_es: "Kombucha", name_en: "Kombucha", aisle: "drinks", created_at: "2026-09-24T10:00:00+00:00" });
const junk = grocery("qwerty", { name_es: "Qwerty", name_en: "Qwerty", source: "human", created_at: "2026-09-25T10:00:00+00:00" });

function setup({ q = "", shelf = null as Shelf | null } = {}) {
  const onShelfChange = vi.fn();
  render(
    <LocaleProvider>
      <GroceryAdminPanel q={q} shelf={shelf} onQueryChange={vi.fn()} onShelfChange={onShelfChange} />
    </LocaleProvider>,
  );
  return { onShelfChange };
}

const rows = () => screen.getAllByRole("button", { expanded: false }).filter((b) => b.closest("li"));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(apiClient, "listGroceryItems").mockResolvedValue([eggs, kombucha, junk]);
  vi.spyOn(apiClient, "getGroceryUsage").mockResolvedValue({
    huevos: [
      { id: "r-flan", title: "Flan" },
      { id: "r-tortilla", title: "Tortilla" },
    ],
  });
});

describe("the list", () => {
  it("shows the newest first", async () => {
    setup();

    await screen.findByText("Qwerty");
    expect(rows().map((row) => within(row).getAllByText(/./)[0].textContent)).toEqual(["Qwerty", "Kombucha", "Eggs"]);
  });

  it("offers the parser's unvouched guesses as their own filter", async () => {
    const { onShelfChange } = setup();

    // `pressed` picks the chip; the row's own "to review" badge sits inside a
    // button that expands rather than toggles.
    fireEvent.click(await screen.findByRole("button", { name: /to review/i, pressed: false }));

    expect(onShelfChange).toHaveBeenCalledWith("unreviewed");
  });

  it("offers only the aisles that hold something", async () => {
    setup();

    await screen.findByText("Qwerty");
    expect(screen.getByRole("button", { name: "Drinks" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Frozen" })).not.toBeInTheDocument();
  });
});

describe("editing a row", () => {
  it("saves every field in one go", async () => {
    const save = vi.spyOn(apiClient, "updateGroceryItem").mockResolvedValue({ ...kombucha, aisle: "canned", confirmed_at: "now" });
    setup();

    fireEvent.click(await screen.findByText("Kombucha"));
    fireEvent.change(screen.getByRole("textbox", { name: "Catalan" }), { target: { value: "Kombutxa" } });
    fireEvent.click(screen.getByRole("button", { name: "Tinned" }));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("kombucha", {
        name_es: "Kombucha",
        name_ca: "Kombutxa",
        name_en: "Kombucha",
        aisle: "canned",
        is_pantry: false,
        default_unit: null,
      }),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("says which row already has the name when the server refuses it", async () => {
    vi.spyOn(apiClient, "updateGroceryItem").mockRejectedValue(new ApiError(409, "Another ingredient already uses that name: huevos"));
    setup();

    fireEvent.click(await screen.findByText("Qwerty"));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("huevos");
  });

  it("will not save a blank name", async () => {
    setup();

    fireEvent.click(await screen.findByText("Qwerty"));
    fireEvent.change(screen.getByRole("textbox", { name: "English" }), { target: { value: "  " } });

    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
  });
});

describe("deleting a row", () => {
  it("asks first, then removes it from the list", async () => {
    const remove = vi.spyOn(apiClient, "deleteGroceryItem").mockResolvedValue();
    setup();

    fireEvent.click(await screen.findByText("Qwerty"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(remove).not.toHaveBeenCalled();
    // The modal's confirm comes after the editor's own button in the document.
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" }).at(-1) as HTMLElement);

    await waitFor(() => expect(remove).toHaveBeenCalledWith("qwerty"));
    await waitFor(() => expect(screen.queryByText("Qwerty")).not.toBeInTheDocument());
  });

  it("never offers it on a seeded row — the next deploy would bring it back", async () => {
    setup();

    fireEvent.click(await screen.findByText("Eggs"));

    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByText(/grocery_seed_data\.py/)).toBeInTheDocument();
  });
});

describe("which recipes use a row", () => {
  it("counts them on the row and links each one from the editor", async () => {
    setup();

    const row = (await screen.findByText("Eggs")).closest("button")!;
    expect(await within(row).findByText(/in 2 recipes/)).toBeInTheDocument();
    fireEvent.click(row);

    expect(screen.getByRole("link", { name: "Flan" })).toHaveAttribute("href", "/dashboard?recipe=r-flan");
    expect(screen.getByRole("link", { name: "Tortilla" })).toHaveAttribute("href", "/dashboard?recipe=r-tortilla");
  });

  it("says so plainly when nothing uses it — the row that is safe to delete", async () => {
    setup();

    fireEvent.click((await screen.findByText("Qwerty")).closest("button")!);

    expect(await screen.findByText("No recipe uses it.")).toBeInTheDocument();
  });

  it("leaves the panel working when the usage cannot be loaded", async () => {
    vi.spyOn(apiClient, "getGroceryUsage").mockRejectedValue(new Error("down"));
    setup();

    fireEvent.click((await screen.findByText("Qwerty")).closest("button")!);

    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    expect(screen.queryByText("No recipe uses it.")).not.toBeInTheDocument();
  });
});
