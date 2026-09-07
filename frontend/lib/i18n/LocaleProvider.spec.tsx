import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { LocaleProvider, useI18n } from "./LocaleProvider";
import { LOCALE_STORAGE_KEY } from "./locales";
import { LanguageToggle } from "@/components/ui/LanguageToggle";

/** Renders one string plus the switcher, which is the whole integration. */
function Probe() {
  const { t, tp, locale } = useI18n();
  return (
    <>
      <LanguageToggle />
      <p data-testid="locale">{locale}</p>
      <p data-testid="copy">{t("common.cancel")}</p>
      <p data-testid="plural">{tp("recipe-row.ingredients", 2)}</p>
    </>
  );
}

function setup() {
  return render(
    <LocaleProvider>
      <Probe />
    </LocaleProvider>,
  );
}

/**
 * The trigger's accessible name is itself translated ("Language: English",
 * "Idioma: Español"), so it cannot be matched with one English word. Spanish
 * and Catalan share "Idioma", which makes two alternatives enough for all
 * three languages.
 */
const TRIGGER = { name: /Language|Idioma/i };

/** Opens the switcher and picks a language, the way a person would. */
function pick(code: "en" | "es" | "ca") {
  const names = { en: "English", es: "Español", ca: "Català" };
  fireEvent.click(screen.getByRole("button", TRIGGER));
  fireEvent.click(screen.getByRole("menuitemradio", { name: new RegExp(names[code]) }));
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "";
  vi.restoreAllMocks();
});

describe("LocaleProvider", () => {
  it("starts from the browser's language when nothing is stored", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["ca-ES", "es"]);
    setup();
    expect(await screen.findByText("Cancel·la")).toBeInTheDocument();
    expect(screen.getByTestId("locale")).toHaveTextContent("ca");
  });

  it("prefers a stored choice over the browser", async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "es");
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["ca-ES"]);
    setup();
    expect(await screen.findByText("Cancelar")).toBeInTheDocument();
  });

  it("falls back to English for a language it doesn't speak", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-DE"]);
    setup();
    expect(await screen.findByText("Cancel")).toBeInTheDocument();
  });

  it("switches every string when the language changes, and persists the choice", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en"]);
    setup();
    expect(await screen.findByText("Cancel")).toBeInTheDocument();

    pick("ca");

    expect(screen.getByTestId("copy")).toHaveTextContent("Cancel·la");
    // The plural too, not just the plain string — they resolve by different paths.
    expect(screen.getByTestId("plural")).toHaveTextContent("2 ingredients");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("ca");
  });

  it("keeps <html lang> in step, which is what a screen reader reads", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en"]);
    setup();
    await screen.findByText("Cancel");
    expect(document.documentElement.lang).toBe("en");

    pick("es");
    expect(document.documentElement.lang).toBe("es");
  });

  it("survives localStorage being unavailable", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["es"]);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    setup();
    // The browser language still applies, and switching still works for the
    // session even though nothing can be written.
    expect(await screen.findByText("Cancelar")).toBeInTheDocument();
    pick("ca");
    expect(screen.getByTestId("copy")).toHaveTextContent("Cancel·la");
  });

  it("shows only the two-letter code until the menu is opened", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["es"]);
    setup();
    await screen.findByText("Cancelar");

    const trigger = screen.getByRole("button", TRIGGER);
    expect(trigger).toHaveTextContent("ES");
    // The full name is not on screen — that is the point of the compact
    // trigger — but it is in the accessible name, so the control still
    // announces which language is active.
    expect(trigger).toHaveAccessibleName(/Español/);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("lists each language in its own name once opened, and marks the active one", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en"]);
    setup();
    fireEvent.click(screen.getByRole("button", TRIGGER));

    for (const name of ["English", "Español", "Català"]) {
      expect(screen.getByRole("menuitemradio", { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(screen.getByRole("menuitemradio", { name: /English/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: /Català/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("closes on Escape and hands focus back to the trigger", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en"]);
    setup();
    const trigger = screen.getByRole("button", TRIGGER);
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    // Leaving focus on a menu that no longer exists strands a keyboard user.
    expect(trigger).toHaveFocus();
  });

  it("closes on an outside press without changing the language", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en"]);
    setup();
    fireEvent.click(screen.getByRole("button", TRIGGER));
    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(await screen.findByText("Cancel")).toBeInTheDocument();
  });

  it("walks the menu with the arrow keys", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en"]);
    setup();
    const menuButton = screen.getByRole("button", TRIGGER);
    fireEvent.click(menuButton);

    const items = screen.getAllByRole("menuitemradio");
    items[0].focus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();

    // Wraps rather than stopping, so holding the key never dead-ends.
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
    expect(items[2]).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Home" });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "End" });
    expect(items[2]).toHaveFocus();
  });
});
