"use client";

import { useState } from "react";
import { Check, Home, X } from "lucide-react";

import type { KitchenInvite } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { initialsOf } from "@/lib/people";

/**
 * "Martina has asked you into her kitchen."
 *
 * **Deliberately not inside the kitchen dropdown**, which is where it would have
 * been cheapest to put it. An invitation is the one thing here that is *addressed
 * to you* and expires into nothing if you never look — and the dropdown is a
 * control you may never open, because the answer it gives ("just you") is
 * already visible on its face. So this is a card on the page, in the slot the
 * guest banner used to occupy.
 *
 * **It says what accepting costs.** Joining is a move: you leave the kitchen you
 * are in, and from then on you and they plan one week. Somebody who reads "join"
 * as "also see their week" would find their own planner replaced, so the body
 * text spends its words on the part that is not reversible by tapping again.
 */
export function InvitationCard({
  invite,
  onAnswer,
}: {
  invite: KitchenInvite;
  onAnswer: (accept: boolean) => Promise<void>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const answer = async (accept: boolean) => {
    // No `if (busy) return` guard: React flushes a discrete event's state update
    // before dispatching the next one, so `disabled` below has already taken
    // effect by the time a second tap arrives. The guard was there and provably
    // unreachable — a mutation removing it changed nothing.
    setBusy(true);
    try {
      await onAnswer(accept);
    } finally {
      setBusy(false);
    }
  };

  const inviter = invite.invited_by_name ?? "";
  const others = invite.members.map((m) => m.display_name).filter((name): name is string => Boolean(name));

  return (
    <section className="mb-5 rounded-3xl border border-tomato/30 bg-tomato/5 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-tomato/15 font-display text-sm font-bold text-tomato-700 dark:text-tomato"
        >
          {inviter ? initialsOf(inviter) : <Home className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-sm font-bold text-fg">{t("kitchen.invitation-heading", { name: inviter })}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{t("kitchen.invitation-body")}</p>
          {/* Who is already in it. Accepting is a move into a household, and
              "whose?" is the question you ask before moving. */}
          {others.length > 0 && (
            <p className="mt-1.5 text-xs font-semibold text-muted">{t("kitchen.invitation-with", { names: others.join(" · ") })}</p>
          )}
        </div>
      </div>

      {/* Full width on a phone, so neither answer is the one your thumb reaches
          by accident. Joining is the affirmative and carries the weight; not now
          stays a quiet outline, because declining is not a failure state. */}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => void answer(false)}
          disabled={busy}
          className="flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-2xl border border-line px-4 text-sm font-semibold text-muted transition-colors hover:border-tomato/40 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
        >
          <X className="h-4 w-4" aria-hidden />
          {t("kitchen.decline")}
        </button>
        <button
          type="button"
          onClick={() => void answer(true)}
          disabled={busy}
          className="flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-2xl bg-tomato px-5 text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
        >
          <Check className="h-4 w-4" aria-hidden />
          {t("kitchen.accept")}
        </button>
      </div>
    </section>
  );
}
