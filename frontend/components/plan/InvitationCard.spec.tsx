import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InvitationCard } from "./InvitationCard";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import type { KitchenInvite } from "@/lib/api-client";

/**
 * "Martina has asked you into her kitchen."
 *
 * Accepting is a *move* — you leave your own kitchen — so the tests here are
 * about the card being honest about that and about both answers reaching the
 * caller. A card that only reported "yes" would strand an invitation on screen
 * forever after it was declined.
 */

const INVITE: KitchenInvite = {
  kitchen_id: "k-2",
  invited_by: "u-martina",
  invited_by_name: "Martina",
  members: [
    { user_id: "u-martina", display_name: "Martina", joined_at: "2026-09-01T00:00:00Z", invited_by: null },
    { user_id: "u-jordi", display_name: "Jordi", joined_at: "2026-09-02T00:00:00Z", invited_by: "u-martina" },
  ],
};

function setup(invite: KitchenInvite = INVITE) {
  const onAnswer = vi.fn().mockResolvedValue(undefined);
  render(
    <LocaleProvider>
      <InvitationCard invite={invite} onAnswer={onAnswer} />
    </LocaleProvider>,
  );
  return { onAnswer };
}

describe("the invitation card", () => {
  it("names who asked", () => {
    setup();

    expect(screen.getByText("Martina has asked you into their kitchen")).toBeInTheDocument();
  });

  it("names who is already in it", () => {
    // Accepting is a move into a household, and "whose?" is the question you
    // ask before moving.
    setup();

    expect(screen.getByText("Already there: Martina · Jordi")).toBeInTheDocument();
  });

  it("says what your own weeks do", () => {
    setup();

    expect(screen.getByText(/stay in your archive/)).toBeInTheDocument();
  });

  it("reports a yes", async () => {
    const { onAnswer } = setup();

    fireEvent.click(screen.getByRole("button", { name: /Join/ }));

    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(true));
  });

  it("reports a no", async () => {
    const { onAnswer } = setup();

    fireEvent.click(screen.getByRole("button", { name: /Not now/ }));

    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false));
  });

  it("does not answer twice on a double tap", async () => {
    // Both buttons go disabled the instant either is pressed, and React flushes
    // that before the next tap is dispatched. Worth pinning: a "join" followed
    // by a "not now" would leave the two sides disagreeing about where you live.
    let settle: () => void = () => {};
    const onAnswer = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)));
    render(
      <LocaleProvider>
        <InvitationCard invite={INVITE} onAnswer={onAnswer} />
      </LocaleProvider>,
    );

    const join = screen.getByRole("button", { name: /Join/ });
    fireEvent.click(join);
    fireEvent.click(join);

    expect(onAnswer).toHaveBeenCalledOnce();
    settle();
    await waitFor(() => expect(join).not.toBeDisabled());
  });

  it("survives an invitation with nobody named on it", () => {
    // A kitchen whose members have no display name yet — possible, because the
    // name is chosen after sign-up.
    setup({ ...INVITE, invited_by_name: null, members: [] });

    expect(screen.getByRole("button", { name: /Join/ })).toBeInTheDocument();
    expect(screen.queryByText(/Already there:/)).not.toBeInTheDocument();
  });
});
