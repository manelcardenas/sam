import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { KitchenBar } from "./KitchenBar";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import type { Kitchen, KitchenMember, Person } from "@/lib/api-client";

/**
 * The control that replaced the share panel (docs/plans/meal-planner-plan.md §8.12).
 *
 * The tests worth having are the ones about *what is offered*, because every one
 * of them is a rule the server also enforces and the UI is only keeping off the
 * screen: you cannot leave a kitchen you are alone in, you cannot remove a
 * member, and you can withdraw an invitation you sent. A UI that offered any of
 * those would look fine and fail on tap.
 *
 * `fireEvent` rather than `user-event` — the latter is not a dependency and
 * `knip` exists to keep it that way.
 */

const NEL: KitchenMember = { user_id: "u-nel", display_name: "Nel", joined_at: "2026-09-01T00:00:00Z", invited_by: null };
const MARTINA: KitchenMember = { user_id: "u-martina", display_name: "Martina", joined_at: "2026-09-02T00:00:00Z", invited_by: "u-nel" };
const INVITED: KitchenMember = { user_id: "u-jordi", display_name: "Jordi", joined_at: null, invited_by: "u-nel" };

const DIRECTORY: Person[] = [
  { id: "u-martina", display_name: "Martina" },
  { id: "u-jordi", display_name: "Jordi" },
];

function kitchen(members: KitchenMember[], pending: KitchenMember[] = []): Kitchen {
  return { id: "k-1", members, pending, created_at: "2026-09-01T00:00:00Z" };
}

function setup(
  value: Kitchen,
  onInvite = vi.fn().mockResolvedValue(null),
  onLoadPeople = vi.fn().mockResolvedValue(DIRECTORY),
) {
  const onWithdraw = vi.fn().mockResolvedValue(undefined);
  const onLeave = vi.fn();
  render(
    <LocaleProvider>
      <KitchenBar
        kitchen={value}
        currentUserId="u-nel"
        onInvite={onInvite}
        onLoadPeople={onLoadPeople}
        onWithdraw={onWithdraw}
        onLeave={onLeave}
      />
    </LocaleProvider>,
  );
  return { onInvite, onLoadPeople, onWithdraw, onLeave };
}

const row = (name: string) => screen.getByRole("button", { name: `Invite ${name}` });

const open = () => fireEvent.click(screen.getByRole("button", { name: /Your kitchen/ }));

describe("the kitchen bar", () => {
  it("says you are on your own without making it sound broken", () => {
    setup(kitchen([NEL]));

    expect(screen.getByRole("button", { name: /Just you/ })).toBeInTheDocument();
  });

  it("counts the household once somebody else is in it", () => {
    setup(kitchen([NEL, MARTINA]));

    expect(screen.getByRole("button", { name: /2 in the kitchen/ })).toBeInTheDocument();
  });

  it("keeps the panel shut until it is asked for", () => {
    setup(kitchen([NEL, MARTINA]));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists everybody, and marks which one is you", () => {
    setup(kitchen([NEL, MARTINA]));
    open();

    const panel = screen.getByRole("dialog");
    expect(panel).toHaveTextContent("Nel");
    expect(panel).toHaveTextContent("Martina");
    expect(panel).toHaveTextContent("You");
  });

  it("shows an outstanding invitation as waiting rather than as a member", () => {
    setup(kitchen([NEL], [INVITED]));
    open();

    expect(screen.getByRole("dialog")).toHaveTextContent("Waiting to answer");
    expect(screen.getByRole("dialog")).toHaveTextContent("Invited");
  });

  it("lets you withdraw an invitation you sent", () => {
    // The one asymmetry the model allows: undoing your own action, not removing
    // somebody from the household.
    const { onWithdraw } = setup(kitchen([NEL], [INVITED]));
    open();

    fireEvent.click(screen.getByRole("button", { name: /Withdraw the invitation to Jordi/ }));

    expect(onWithdraw).toHaveBeenCalledWith(INVITED);
  });

  it("offers no way to remove a member", () => {
    // Membership is symmetric — with no owner and no admin, an eject button
    // would have to invent one. The server refuses it; this keeps it off screen.
    setup(kitchen([NEL, MARTINA]));
    open();

    expect(screen.queryByRole("button", { name: /Withdraw/ })).not.toBeInTheDocument();
  });

  it("asks for the list of people only once somebody opens the panel", async () => {
    // The planner loads every day; this list is read the once. Fetching it with
    // the week would be a request nobody asked for.
    const { onLoadPeople } = setup(kitchen([NEL]));

    expect(onLoadPeople).not.toHaveBeenCalled();

    open();
    await waitFor(() => expect(onLoadPeople).toHaveBeenCalledOnce());
  });

  it("offers the people you could ask, by name", async () => {
    setup(kitchen([NEL]));
    open();

    expect(await screen.findByRole("button", { name: "Invite Martina" })).toBeInTheDocument();
    expect(row("Jordi")).toBeInTheDocument();
  });

  it("invites the person you tap, not a name you typed", async () => {
    // The whole point of the change: there is nothing here to misspell.
    const { onInvite } = setup(kitchen([NEL]));
    open();

    fireEvent.click(await screen.findByRole("button", { name: "Invite Martina" }));

    await waitFor(() => expect(onInvite).toHaveBeenCalledWith({ id: "u-martina", display_name: "Martina" }));
  });

  it("stops offering somebody already in the kitchen", async () => {
    setup(kitchen([NEL, MARTINA]));
    open();

    expect(await screen.findByRole("button", { name: "Invite Jordi" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite Martina" })).not.toBeInTheDocument();
  });

  it("stops offering somebody already asked", async () => {
    // The server filters the list when it is drawn; this keeps it right after an
    // invitation without a second round trip.
    setup(kitchen([NEL], [INVITED]));
    open();

    expect(await screen.findByRole("button", { name: "Invite Martina" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite Jordi" })).not.toBeInTheDocument();
  });

  it("says so when there is nobody left to ask", async () => {
    setup(kitchen([NEL]), undefined, vi.fn().mockResolvedValue([]));
    open();

    expect(await screen.findByText("Everyone in SAM is already here.")).toBeInTheDocument();
  });

  it("holds every row while one invitation is in flight", async () => {
    // Two invitations from two taps would be two invitations, and the second one
    // is never the one you meant.
    const { onInvite } = setup(kitchen([NEL]), vi.fn(() => new Promise<null>(() => {})));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Invite Martina" }));

    expect(row("Jordi")).toBeDisabled();
    fireEvent.click(row("Martina"));
    expect(onInvite).toHaveBeenCalledOnce();
  });

  it("says why an invitation did not go out", async () => {
    setup(kitchen([NEL]), vi.fn().mockResolvedValue("Martina is already in this kitchen"));
    open();

    fireEvent.click(await screen.findByRole("button", { name: "Invite Martina" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Martina is already in this kitchen");
  });

  it("offers a way back when the list itself fails to load", async () => {
    // Without this the panel is a dead end until the page is reloaded.
    const onLoadPeople = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(DIRECTORY);
    setup(kitchen([NEL]), undefined, onLoadPeople);
    open();

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("button", { name: "Invite Martina" })).toBeInTheDocument();
  });

  it("offers no way out of a kitchen you are alone in", () => {
    // Leaving would make a second empty household and move nothing; the server
    // refuses it, and a button that always errors is worse than no button.
    setup(kitchen([NEL]));
    open();

    expect(screen.queryByRole("button", { name: "Leave this kitchen" })).not.toBeInTheDocument();
  });

  it("offers the way out once there is something to leave", () => {
    const { onLeave } = setup(kitchen([NEL, MARTINA]));
    open();

    fireEvent.click(screen.getByRole("button", { name: "Leave this kitchen" }));

    expect(onLeave).toHaveBeenCalledOnce();
  });

  it("closes on Escape", () => {
    setup(kitchen([NEL, MARTINA]));
    open();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
