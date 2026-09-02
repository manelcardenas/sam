import { Star, Store, Utensils } from "lucide-react";
import type { UserStats } from "@/lib/api-client";

/**
 * The four headline figures at the top of the profile.
 *
 * Set in the serif at display size: these are the page's one moment of scale,
 * and reading them as numerals-first is the whole point — the labels are
 * support. `tabular-nums` keeps them from jittering as values change.
 *
 * Renders zeros rather than hiding for a user with no reviews: an empty strip
 * that says 0 places is an invitation, whereas a missing strip just looks broken.
 */
export function StatsStrip({ stats }: { stats: UserStats }) {
  const items: { label: string; value: string; icon: typeof Star }[] = [
    { label: "places", value: String(stats.places_reviewed), icon: Store },
    { label: "reviews", value: String(stats.reviews_written), icon: Utensils },
    {
      label: "you average",
      value: stats.average_score_given != null ? stats.average_score_given.toFixed(1) : "—",
      icon: Star,
    },
  ];

  return (
    <section aria-label="Your numbers" className="grid grid-cols-3 gap-3 sm:gap-4">
      {items.map(({ label, value, icon: Icon }) => (
        <div
          key={label}
          className="rounded-3xl border border-line bg-surface px-3 py-4 text-center sm:px-4"
        >
          <Icon className="mx-auto mb-1.5 h-4 w-4 text-tomato/70" aria-hidden />
          <p className="font-serif text-2xl font-semibold tabular-nums leading-none text-fg sm:text-3xl">
            {value}
          </p>
          <p className="mt-1.5 text-[0.7rem] uppercase tracking-wide text-muted">{label}</p>
        </div>
      ))}

      {/* Fourth figure is a word, not a number, so it spans the row underneath
          rather than being squeezed into a numeric column where a long cuisine
          name ("Vegan/Vegetarian") would wrap badly. */}
      {stats.top_cuisine && (
        <div className="col-span-3 flex items-center justify-center gap-2 rounded-3xl border border-dashed border-line bg-surface-2/60 px-4 py-3 text-sm">
          <span className="text-muted">Mostly eating</span>
          <span className="font-serif text-base font-semibold italic text-fg">
            {stats.top_cuisine}
          </span>
        </div>
      )}
    </section>
  );
}
