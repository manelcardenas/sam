import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PlanPage from "./page";
import { apiClient } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";

/**
 * The phone back gesture on /plan. Like `app/dine/page.spec.tsx`, it relies on
 * jsdom's real session history. The week grid, the list and the kitchen bar
 * are stubbed out: what is under test is which entries the page leaves in
 * history, not what the views draw.
 *
 * /plan never had /dine's stuck-flag bug (its URL is restored on mount, so the
 * writer's mount run clears the flag at once); this keeps it that way.
 */

vi.mock("@/components/auth/useAuthGate", () => ({
  useAuthGate: () => ({ me: { id: "u1", display_name: "Ana" } }),
}));
vi.mock("@/components/shell/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/useLivePlan", () => ({ useLivePlan: () => undefined }));
vi.mock("@/components/plan/WeekGrid", () => ({ WeekGrid: () => <div data-testid="calendar" /> }));
vi.mock("@/components/plan/ShoppingList", () => ({ ShoppingList: () => <div data-testid="list" /> }));
vi.mock("@/components/plan/KitchenBar", () => ({ KitchenBar: () => null }));
vi.mock("@/components/plan/SlotSheet", () => ({ SlotSheet: () => null }));
vi.mock("@/components/plan/InvitationCard", () => ({ InvitationCard: () => null }));

const here = () => `${window.location.pathname}${window.location.search}`;

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  vi.spyOn(apiClient, "carryForward").mockResolvedValue(null as never);
  vi.spyOn(apiClient, "getPlan").mockResolvedValue(null as never);
  vi.spyOn(apiClient, "listRecipes").mockResolvedValue([]);
  vi.spyOn(apiClient, "listGroceryItems").mockResolvedValue([]);
  vi.spyOn(apiClient, "getKitchen").mockResolvedValue(null as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("/plan back navigation", () => {
  it("back from the shopping list, opened first thing, returns to the calendar and not to the previous page", async () => {
    window.history.replaceState(null, "", "/dine");
    window.history.pushState(null, "", "/plan");
    render(
      <LocaleProvider>
        <PlanPage />
      </LocaleProvider>,
    );
    await screen.findByTestId("calendar");

    fireEvent.click(screen.getByRole("button", { name: /Shopping list/ }));
    await screen.findByTestId("list");
    expect(here()).toBe("/plan?view=list");

    await act(async () => {
      window.history.back();
      await waitFor(() => expect(here()).toBe("/plan"));
    });
    expect(await screen.findByTestId("calendar")).toBeInTheDocument();
  });
});
