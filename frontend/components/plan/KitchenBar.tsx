"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, DoorOpen, Plus, Search, UserPlus, X } from "lucide-react";

import type { Kitchen, KitchenMember, Person } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { initialsOf } from "@/lib/people";

/**
 * Who you share this planner with (docs/plans/meal-planner-plan.md §8.12).
 *
 * **This replaced a panel at the bottom of the page**, and the shrinking is the
 * point. Sharing used to be a section with a heading, a paragraph and a form,
 * sitting below the week — a permanent block of explanation for something that
 * is set up once and then never touched. What you actually want on screen every
 * day is the one-glance answer: *who else is in this?* That is two initials
 * wide. Everything else moves behind them.
 *
 * **A rounded rectangle next to round pills**, following `Chip.tsx`'s rule: the
 * app uses fully-round pills for things that toggle and rounded rectangles for
 * things that hold a value. This holds a value — the household — so the shape is
 * already decided, and it is what tells a reader it behaves differently from the
 * view toggle beside it.
 *
 * **The panel is portalled**, like `AuthorSelect`, because the header row it
 * sits in wraps and scrolls on a phone and an absolutely-positioned panel would
 * be clipped by it. Position is computed from the trigger's rect and re-run
 * while open, which is also what lets it flip above the trigger near the bottom
 * of a screen instead of opening off-screen.
 *
 * **Inviting is a list, not a text field.** It used to be: type their display
 * name exactly, and a misremembered spelling came back as "nobody here is called
 * that" — the app knew the answer and made you guess it anyway. The rows below
 * are the people you could ask, fetched already filtered, so the error stops
 * existing rather than being explained better. One tap sends the invitation,
 * because the undo is the ✕ on the row it immediately becomes, two lines up.
 *
 * Keyboard: Escape closes and returns focus to the trigger; the panel is a plain
 * dialog rather than a listbox, because nothing in it is selected — the rows are
 * people, and the controls act on them.
 */

/** Gutter kept between the panel and the viewport edge, in px. */
const EDGE = 12;
const PANEL_WIDTH = 296;
/** Past this many, the stack stops being readable and becomes a count. */
const AVATARS_SHOWN = 3;
/** Above this many invitable people, scanning beats reading and a search box earns its row. */
const SEARCHABLE_FROM = 8;

interface Position {
  top: number;
  left: number;
  maxHeight: number;
}

export function KitchenBar({
  kitchen,
  currentUserId,
  onInvite,
  onLoadPeople,
  onWithdraw,
  onLeave,
}: {
  kitchen: Kitchen;
  currentUserId: string | null;
  /** Resolves to an error message, or null when the invitation went out. */
  onInvite: (person: Person) => Promise<string | null>;
  /** Everybody invitable. Called on first open, not on mount — most days nobody opens this. */
  onLoadPeople: () => Promise<Person[]>;
  onWithdraw: (member: KitchenMember) => Promise<void>;
  onLeave: () => void;
}) {
  const { t, tp } = useI18n();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [peopleFailed, setPeopleFailed] = useState(false);
  const [needle, setNeedle] = useState("");
  const [inviting, setInviting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - EDGE * 2;
    const above = rect.top - EDGE * 2;
    // Flip only when below genuinely cannot hold a useful panel *and* above is
    // roomier. Flipping on a few pixels makes the panel jump as the page scrolls.
    const flip = below < 260 && above > below;

    setPosition({
      top: flip ? Math.max(EDGE, rect.top - Math.min(above, 420) - 8) : rect.bottom + 8,
      // Right-aligned to the trigger, then clamped: this control sits at the end
      // of a row that wraps, so anchoring to its left edge would hang the panel
      // off the side of a phone.
      left: Math.min(Math.max(EDGE, rect.right - PANEL_WIDTH), window.innerWidth - PANEL_WIDTH - EDGE),
      maxHeight: Math.min(flip ? above : below, 420),
    });
  }, []);

  // Before paint, so the panel never renders in the wrong place for one frame.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const replace = () => place();
    // `true` captures scrolls of the containers this sits inside, not just the window.
    window.addEventListener("scroll", replace, true);
    window.addEventListener("resize", replace);
    return () => {
      window.removeEventListener("scroll", replace, true);
      window.removeEventListener("resize", replace);
    };
  }, [open, place]);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    setError("");
    setNeedle("");
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Fetched on first open rather than with the plan: the planner loads every
  // day, this list is read the once. `peopleFailed` stops a failure from
  // retrying forever; the panel offers the retry instead.
  useEffect(() => {
    if (!open || people || peopleFailed) return;
    let live = true;
    onLoadPeople().then(
      (list) => live && setPeople(list),
      () => live && setPeopleFailed(true),
    );
    return () => {
      live = false;
    };
  }, [open, people, peopleFailed, onLoadPeople]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    // Capture, so Escape closes this before anything it may be sitting inside.
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  const askIn = async (person: Person) => {
    // No re-entrancy guard: every row is `disabled` while one is in flight, and
    // React flushes that before dispatching the next click.
    setInviting(person.id);
    setError("");
    try {
      const failure = await onInvite(person);
      if (failure) setError(failure);
      else setNeedle("");
    } finally {
      setInviting(null);
    }
  };

  // The server filtered this list when it was drawn; this keeps it right after
  // an invitation without a second round trip, because `kitchen.pending` has
  // already grown by the time the panel re-renders.
  const here = new Set([...kitchen.members, ...kitchen.pending].map((member) => member.user_id));
  const invitable = (people ?? []).filter((person) => !here.has(person.id));
  const matches = needle.trim()
    ? invitable.filter((person) => person.display_name.toLocaleLowerCase().includes(needle.trim().toLocaleLowerCase()))
    : invitable;

  const alone = kitchen.members.length <= 1;
  const shown = kitchen.members.slice(0, AVATARS_SHOWN);
  const overflow = kitchen.members.length - shown.length;
  const label = alone ? t("kitchen.just-you") : tp("kitchen.members-count", kitchen.members.length);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${t("kitchen.heading")}: ${label}`}
        className={`flex h-11 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-2xl border bg-surface pl-2 pr-3 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 ${
          open ? "border-tomato/40 text-fg" : "border-line text-muted hover:border-tomato/40 hover:text-fg"
        }`}
      >
        <span className="flex items-center" aria-hidden>
          {shown.map((member, index) => (
            <Avatar key={member.user_id} name={member.display_name} className={index > 0 ? "-ml-2" : ""} />
          ))}
          {overflow > 0 && (
            <span className="-ml-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-surface-2 font-display text-[0.6rem] font-bold text-muted">
              +{overflow}
            </span>
          )}
          {/* A dashed slot where the second person would be. It says "there is
              room for somebody here" without spending a word on it, and it is
              the only state where inviting is the obvious next thing. */}
          {alone && (
            <span className="-ml-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-dashed border-line bg-surface text-muted">
              <Plus className="h-3 w-3" />
            </span>
          )}
        </span>
        {/* The label never disappears. A control that swaps its label for its
            value stops saying what it is the moment it is in use. */}
        <span className="font-semibold">{t("kitchen.title")}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={t("kitchen.heading")}
            style={{ top: position.top, left: position.left, width: PANEL_WIDTH, maxHeight: position.maxHeight }}
            className="fixed z-[60] flex flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-paw will-fetch animate-fetch-in"
          >
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-display text-sm font-bold text-fg">{t("kitchen.heading")}</h2>
              {/* The hint is not decoration: "kitchen" is a word this app made
                  up, and the one thing a reader needs told is that it has no
                  owner — everybody in it can change everything. */}
              <p className="mt-1 text-xs leading-relaxed text-muted">{t("kitchen.hint")}</p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              <ul>
                {kitchen.members.map((member) => (
                  <li key={member.user_id}>
                    <PersonRow member={member} you={member.user_id === currentUserId} />
                  </li>
                ))}
              </ul>

              {kitchen.pending.length > 0 && (
                <>
                  <h3 className="mt-2 px-2 pb-1 font-display text-[0.65rem] font-bold uppercase tracking-wider text-muted">
                    {t("kitchen.pending-heading")}
                  </h3>
                  <ul>
                    {kitchen.pending.map((member) => (
                      <li key={member.user_id}>
                        <PersonRow member={member} pending onWithdraw={() => void onWithdraw(member)} />
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <h3 className="mt-2 px-2 pb-1 font-display text-[0.65rem] font-bold uppercase tracking-wider text-muted">
                {t("kitchen.invite-heading")}
              </h3>

              {/* The search box appears only when the list has stopped being
                  scannable. At three housemates it would be a row of furniture. */}
              {invitable.length >= SEARCHABLE_FROM && (
                <div className="relative px-1 pb-1">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                  <input
                    type="search"
                    value={needle}
                    onChange={(e) => setNeedle(e.target.value)}
                    aria-label={t("common.search-people")}
                    placeholder={t("common.search-people")}
                    className="h-10 w-full rounded-2xl bg-surface-2 pl-9 pr-3 text-sm text-fg placeholder:text-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                  />
                </div>
              )}

              {peopleFailed ? (
                <div className="px-2 py-3 text-center">
                  <p className="text-xs text-muted">{t("kitchen.people-failed")}</p>
                  <button
                    type="button"
                    onClick={() => setPeopleFailed(false)}
                    className="mt-1 cursor-pointer rounded-full px-2 py-1 text-xs font-bold text-tomato underline-offset-4 transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                  >
                    {t("kitchen.people-retry")}
                  </button>
                </div>
              ) : people === null ? (
                /* Two rows of the right height, so the panel does not resize
                   under the finger that opened it. */
                <ul aria-hidden>
                  {[0, 1].map((row) => (
                    <li key={row} className="flex h-11 items-center gap-2.5 px-2">
                      <span className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-surface-2" />
                      <span className="h-3 flex-1 animate-pulse rounded-full bg-surface-2" />
                    </li>
                  ))}
                </ul>
              ) : matches.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-muted">
                  {invitable.length === 0 ? t("kitchen.invite-nobody") : t("common.no-people-match")}
                </p>
              ) : (
                <ul>
                  {matches.map((person) => (
                    <li key={person.id}>
                      <button
                        type="button"
                        onClick={() => void askIn(person)}
                        disabled={inviting !== null}
                        // The row *is* the button, so its name has to carry the
                        // verb the visible text leaves to the icon.
                        aria-label={t("kitchen.invite-person", { name: person.display_name })}
                        title={t("kitchen.invite-person", { name: person.display_name })}
                        className="flex h-11 w-full cursor-pointer items-center gap-2.5 rounded-2xl px-2 text-left transition-colors hover:bg-tomato/10 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                      >
                        <span aria-hidden className="shrink-0">
                          <Avatar name={person.display_name} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{person.display_name}</span>
                        {/* The verb lives on the icon rather than in a column of
                            repeated "Invite" buttons — the row is the button. */}
                        <UserPlus
                          className={`h-4 w-4 shrink-0 ${inviting === person.id ? "animate-pulse text-tomato" : "text-muted"}`}
                          aria-hidden
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {error && (
              <p role="alert" className="border-t border-line px-4 py-2 text-xs font-medium text-tomato-700 dark:text-tomato">
                {error}
              </p>
            )}

            {/* Only when there is something to leave. A kitchen of one has
                nowhere to go, and the server refuses it — a button that always
                errors is worse than no button. */}
            {!alone && (
              <button
                type="button"
                onClick={() => {
                  close(false);
                  onLeave();
                }}
                className="flex h-11 w-full cursor-pointer items-center gap-2 border-t border-line px-4 text-left text-sm font-semibold text-muted transition-colors hover:bg-tomato/10 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
              >
                <DoorOpen className="h-4 w-4" aria-hidden />
                {t("kitchen.leave")}
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

function Avatar({ name, className = "" }: { name: string | null; className?: string }) {
  return (
    <span
      className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-tomato/15 font-display text-[0.6rem] font-bold text-tomato-700 dark:text-tomato ${className}`}
    >
      {initialsOf(name ?? "?")}
    </span>
  );
}

function PersonRow({
  member,
  you = false,
  pending = false,
  onWithdraw,
}: {
  member: KitchenMember;
  you?: boolean;
  pending?: boolean;
  onWithdraw?: () => void;
}) {
  const { t } = useI18n();
  const name = member.display_name ?? member.user_id;

  return (
    <div className={`flex h-11 items-center gap-2.5 rounded-2xl px-2 ${pending ? "opacity-70" : ""}`}>
      <span aria-hidden className="shrink-0">
        <Avatar name={member.display_name} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{name}</span>
      {you && (
        <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-muted">
          {t("common.you")}
        </span>
      )}
      {pending && (
        <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-muted">
          {t("kitchen.invited")}
        </span>
      )}
      {/* Only pending rows get an X, and it is the one asymmetry the model
          allows: withdrawing an invitation you sent is undoing your own action,
          not removing somebody from the household. */}
      {pending && onWithdraw && (
        <button
          type="button"
          onClick={onWithdraw}
          aria-label={t("kitchen.withdraw", { name })}
          title={t("kitchen.withdraw", { name })}
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-tomato/15 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
