"use client";

import { useState } from "react";
import { UserPlus, Users, X } from "lucide-react";
import type { PlanGuest } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * Who else can see this week (docs/plans/meal-planner-plan.md §4.3).
 *
 * **The hint is not decoration.** "Share" means something different in every app
 * that has it, and here it is unusually narrow: guests see the week and tick the
 * list, and cannot touch the recipes. Saying so at the point of sharing is
 * cheaper than an owner discovering the limit by being asked about it — and
 * cheaper than the opposite discovery, where someone shares thinking it is
 * read-only and finds their Wednesday rearranged.
 *
 * Owner-only: a guest never sees this panel, because a guest resharing would
 * hand out access the owner did not grant.
 */
export function SharePanel({
  guests,
  onShare,
  onUnshare,
}: {
  guests: PlanGuest[];
  onShare: (displayName: string) => Promise<string | null>;
  onUnshare: (guest: PlanGuest) => Promise<void>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = draft.trim();
    if (!name || busy) return;
    setBusy(true);
    setError("");
    try {
      const failure = await onShare(name);
      if (failure) setError(failure);
      else setDraft("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-3xl border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 font-display text-sm font-bold text-fg">
        <Users className="h-4 w-4 text-muted" aria-hidden />
        {t("plan.shared-with")}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("plan.share-hint")}</p>

      {guests.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {guests.map((guest) => (
            <li key={guest.user_id}>
              <span className="flex items-center gap-1 rounded-full border border-line bg-surface-2 py-1 pl-3 pr-1 text-sm font-semibold text-fg">
                {guest.display_name ?? guest.user_id}
                <button
                  type="button"
                  onClick={() => void onUnshare(guest)}
                  aria-label={t("plan.stop-sharing", { name: guest.display_name ?? guest.user_id })}
                  title={t("plan.stop-sharing", { name: guest.display_name ?? guest.user_id })}
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-tomato/15 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">{t("plan.nobody-shared")}</p>
      )}

      <form onSubmit={submit} className="mt-4 flex items-center gap-2">
        <label htmlFor="plan-share" className="sr-only">
          {t("plan.share")}
        </label>
        <input
          id="plan-share"
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            // Clearing on edit, not on submit: leaving "nobody is called that"
            // under a name they have since corrected reads as the correction
            // having failed too.
            if (error) setError("");
          }}
          maxLength={50}
          placeholder={t("plan.share-placeholder")}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "plan-share-error" : undefined}
          className="h-11 min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30"
        />
        <button
          type="submit"
          disabled={!draft.trim() || busy}
          className="flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-2xl border border-line px-4 text-sm font-semibold text-fg transition-colors hover:border-tomato/50 hover:text-tomato disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
        >
          <UserPlus className="h-4 w-4" />
          {t("plan.share")}
        </button>
      </form>

      {error && (
        <p id="plan-share-error" className="mt-2 text-sm font-medium text-tomato-700 dark:text-tomato">
          {error}
        </p>
      )}
    </section>
  );
}
