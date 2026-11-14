"use client";

import { CalendarDays } from "lucide-react";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { formatMonthYear } from "@/lib/format";

/**
 * The one moment of scale on the profile.
 *
 * The old page opened with an `<h1>Your profile</h1>` and a subtitle, which is
 * a label for a page rather than a picture of a person — you already know
 * whose profile you are on. This says who you are instead.
 *
 * Flat, in the section's colour: the monogram is a soft plate of the accent
 * with the initial in it, like a contact photo placeholder. It used to be a
 * tomato-to-amber gradient with a tomato glow over a two-colour radial wash —
 * the one gradient left in an app that is otherwise flat pastels, so it read
 * as borrowed from a different product (raised 2026-11-14).
 */
export function ProfileHero({
  name,
  email,
  since,
}: {
  name: string;
  email: string;
  /** ISO timestamp of account creation; the year and month are all that's shown. */
  since?: string;
}) {
  const { locale, t } = useI18n();
  // A name is required before any page renders (useAuthGate bounces to
  // /profile/complete without one), so the fallback is defensive only.
  const initial = (name.trim()[0] ?? "?").toUpperCase();

  return (
    <section className="animate-settle relative overflow-hidden rounded-4xl border border-line bg-surface">
      <div className="relative flex items-center gap-4 p-6 sm:gap-5 sm:p-7">
        <span
          aria-hidden
          className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-accent/15 font-display text-2xl font-bold text-accent-700 dark:bg-accent/25 dark:text-accent sm:h-20 sm:w-20 sm:text-3xl"
        >
          {initial}
        </span>

        <div className="min-w-0">
          <h1 className="truncate font-serif text-2xl font-semibold italic text-fg sm:text-3xl">
            {name}
          </h1>
          {/* Both lines are quiet on purpose: the email is an identifier you
              never read, and the date is trivia. The name is the content. */}
          <p className="mt-1 truncate text-sm text-muted">{email}</p>
          {since && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("profile.since", { month: formatMonthYear(since, locale) })}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
