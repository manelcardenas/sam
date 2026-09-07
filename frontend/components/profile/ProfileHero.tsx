import { CalendarDays } from "lucide-react";

/**
 * The one moment of scale on the profile.
 *
 * The old page opened with an `<h1>Your profile</h1>` and a subtitle, which is
 * a label for a page rather than a picture of a person — you already know
 * whose profile you are on. This says who you are instead.
 *
 * The wash is two radial gradients in the brand duotone at 12–14% alpha over
 * `surface`, not a linear `from-tomato to-amber`: a linear ramp across a wide
 * card reads as a banner from a different product, while offset radials read as
 * light falling on paper, which is the register the rest of the app is in. The
 * `bg-paws` dot texture sits on top of it for the same reason.
 *
 * The monogram is the only place in the app where the two brand colours meet
 * directly, which is what makes it the anchor.
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
  // A name is required before any page renders (useAuthGate bounces to
  // /profile/complete without one), so the fallback is defensive only.
  const initial = (name.trim()[0] ?? "?").toUpperCase();

  return (
    <section className="animate-settle relative overflow-hidden rounded-4xl border border-line bg-surface shadow-paw">
      {/* Wash + texture, behind everything and inert to the pointer. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_0%_0%,rgba(228,87,46,0.14),transparent_58%),radial-gradient(110%_130%_at_100%_10%,rgba(244,160,36,0.13),transparent_55%)]"
      />
      <div aria-hidden className="bg-paws pointer-events-none absolute inset-0 opacity-70" />

      <div className="relative flex items-center gap-4 p-6 sm:gap-5 sm:p-7">
        <span
          aria-hidden
          className="grid h-16 w-16 shrink-0 place-items-center rounded-3xl bg-gradient-to-br from-tomato to-amber font-display text-2xl font-bold text-white shadow-[0_10px_24px_-10px_rgba(228,87,46,0.75)] ring-1 ring-inset ring-white/25 sm:h-20 sm:w-20 sm:text-3xl"
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
              Cooking here since {formatSince(since)}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/** "September 2025" in the viewer's locale. Month precision — the day is noise. */
function formatSince(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
