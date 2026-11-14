import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DinePage from "./page";
import { apiClient, type RestaurantDetail } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { announceTabHome } from "@/lib/url-state";

/**
 * The phone back gesture on /dine. jsdom keeps a real session history and
 * fires `popstate` on `history.back()`, so these walk the same entries a phone
 * would. What is faked is everything around the page: the signed-in user, the
 * shell, the maps and the API.
 */

vi.mock("@/components/auth/useAuthGate", () => ({
  useAuthGate: () => ({ me: { id: "u1", display_name: "Ana" } }),
}));
vi.mock("@/components/shell/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

const casaPepe: RestaurantDetail = {
  id: "r1",
  name: "Casa Pepe",
  address: "Carrer de Mallorca 401",
  price_level: 2,
  latitude: null,
  longitude: null,
  external_place_id: null,
  cuisines: ["tapas"],
  created_by: "u1",
  created_by_name: "Ana",
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  review_count: 0,
  average_location: null,
  average_food: null,
  average_service: null,
  average_value: null,
  average_overall: null,
  last_visited_at: null,
  reviewer_names: [],
  reviewers: [],
  last_comment: null,
  last_comment_by: null,
  last_comment_at: null,
};

/** Where the address bar is, as the test reads it. */
const here = () => `${window.location.pathname}${window.location.search}`;

/** `history.back()` in jsdom is asynchronous, like in a browser: wait for the address bar to move. */
async function back() {
  const before = here();
  await act(async () => {
    window.history.back();
    await waitFor(() => expect(here()).not.toBe(before));
  });
}

function renderPage() {
  return render(
    <LocaleProvider>
      <DinePage />
    </LocaleProvider>,
  );
}

const listHeading = () => screen.findByRole("heading", { name: "Where shall we eat?" });
/** Only the restaurant page has a Back button — the list cards carry the name as a heading too. */
const detailBack = () => screen.findByRole("button", { name: "Back" });

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  vi.spyOn(apiClient, "searchRestaurants").mockResolvedValue([casaPepe]);
  vi.spyOn(apiClient, "getRestaurant").mockResolvedValue(casaPepe);
  vi.spyOn(apiClient, "listReviews").mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("/dine back navigation", () => {
  it("back from the first restaurant you open returns to the list, not to the previous page", async () => {
    window.history.replaceState(null, "", "/plan");
    window.history.pushState(null, "", "/dine");
    renderPage();
    await listHeading();

    fireEvent.click(screen.getByRole("button", { name: "Casa Pepe" })); // the card
    await detailBack();
    expect(here()).toBe("/dine?place=r1");

    await back();
    expect(here()).toBe("/dine");
    expect(await listHeading()).toBeInTheDocument();
  });

  it("a link straight into a restaurant puts the list underneath it, for both back paths", async () => {
    window.history.replaceState(null, "", "/profile");
    window.history.pushState(null, "", "/dine?place=r1");
    renderPage();
    await detailBack();

    // The in-app Back walks history rather than pushing a list entry on top…
    fireEvent.click(await detailBack());
    await waitFor(() => expect(here()).toBe("/dine"));
    expect(await listHeading()).toBeInTheDocument();

    // …so the next back gesture leaves /dine instead of reopening the restaurant.
    await back();
    expect(here()).toBe("/profile");
  });

  it("a reload inside a restaurant keeps one list underneath, not two", async () => {
    // What the page leaves behind after /plan → /dine → open Casa Pepe; the
    // restaurant entry carries the depth the page wrote, as a reload keeps it.
    window.history.replaceState(null, "", "/plan");
    window.history.pushState(null, "", "/dine");
    window.history.pushState({ samDepth: 1 }, "", "/dine?place=r1");
    const entries = window.history.length;
    renderPage();
    await detailBack();
    expect(window.history.length).toBe(entries); // nothing synthesized on top

    await back();
    expect(here()).toBe("/dine");
    await back();
    expect(here()).toBe("/plan"); // one back for the list, not two
  });
});

describe("tapping the Dine tab while on /dine", () => {
  it("goes back to the list, and the next back leaves /dine", async () => {
    window.history.replaceState(null, "", "/plan");
    window.history.pushState(null, "", "/dine");
    renderPage();
    await listHeading();
    fireEvent.click(screen.getByRole("button", { name: "Casa Pepe" }));
    await detailBack();

    await act(async () => {
      announceTabHome();
      await waitFor(() => expect(here()).toBe("/dine"));
    });
    expect(await listHeading()).toBeInTheDocument();

    // Popped, not pushed: the restaurant is not waiting behind the list.
    await back();
    expect(here()).toBe("/plan");
  });

  it("on the list already, changes nothing", async () => {
    window.history.replaceState(null, "", "/dine");
    renderPage();
    await listHeading();
    const entries = window.history.length;

    act(() => announceTabHome());

    expect(here()).toBe("/dine");
    expect(window.history.length).toBe(entries);
  });
});
