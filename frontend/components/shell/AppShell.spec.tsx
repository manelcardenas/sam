import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";

/**
 * The tab bar's one rule: the tab you are on goes to its page's main screen
 * (announced, for the page to answer — see `useTabHome`); any other tab is an
 * ordinary link.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/dine",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("aws-amplify/auth", () => ({ signOut: vi.fn() }));
// Decoration, and ThemeToggle needs matchMedia, which jsdom lacks.
vi.mock("@/components/ui/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/ui/LanguageToggle", () => ({ LanguageToggle: () => null }));
vi.mock("@/components/brand/SamMascot", () => ({ SamMascot: () => null }));

const announced = vi.fn();

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  window.addEventListener("sam:tab-home", announced);
  render(
    <LocaleProvider>
      <AppShell>content</AppShell>
    </LocaleProvider>,
  );
});

afterEach(() => {
  window.removeEventListener("sam:tab-home", announced);
  announced.mockClear();
  window.localStorage.clear();
});

/** The mobile tab bar's link, which is the one this was reported on. */
const tab = (name: string) => screen.getByRole("navigation", { name: "Primary" }).querySelector(`a[href="${name}"]`)!;

describe("tab bar", () => {
  it("the current tab announces going home instead of navigating", () => {
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    tab("/dine").dispatchEvent(click);

    expect(announced).toHaveBeenCalledTimes(1);
    expect(click.defaultPrevented).toBe(true);
  });

  it("another tab is a plain link", () => {
    fireEvent.click(tab("/plan"));

    expect(announced).not.toHaveBeenCalled();
  });

  it("a cmd-click on the current tab still opens it in a new browser tab", () => {
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, metaKey: true });
    tab("/dine").dispatchEvent(click);

    expect(announced).not.toHaveBeenCalled();
  });
});
