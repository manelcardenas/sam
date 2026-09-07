"use client";

import { Star, Store, Utensils } from "lucide-react";
import type { UserStats } from "@/lib/api-client";
import { useCountUp } from "@/lib/useCountUp";

/**
 * The three headline figures at the top of the profile.
 *
 * Set in the serif at display size: these are the page's one moment of scale,
 * and reading them as numerals-first is the whole point — the labels are
 * support. `tabular-nums` keeps them from jittering as they count up.
 *
 * **Each figure gets its own accent** rather than all three sharing tomato.
 * Three identical tiles read as one control repeated; three tinted ones read as
 * three different facts, which is what they are. The colours are the app's
 * existing palette (tomato, amber, leaf) — nothing new is introduced, they were
 * simply unreachable as tokens until now.
 *
 * Renders zeros rather than hiding for a user with no reviews: an empty strip
 * that says 0 places is an invitation, whereas a missing strip looks broken.
 */
export function StatsStrip({ stats }: { stats: UserStats }) {
  return (
    <section aria-label="Your numbers" className="grid grid-cols-3 gap-3 sm:gap-4">
      <Figure
        label="places"
        value={stats.places_reviewed}
        icon={Store}
        tint="tomato"
      />
      <Figure
        label="reviews"
        value={stats.reviews_written}
        icon={Utensils}
        tint="amber"
      />
      <Figure
        label="you average"
        value={stats.average_score_given}
        decimals={1}
        icon={Star}
        tint="leaf"
      />

      {/* The fourth figure is a word, not a number, so it spans the row
          underneath rather than being squeezed into a numeric column where a
          long cuisine name ("Vegan/Vegetarian") would wrap badly. */}
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

/** Per-tint classes, spelled out so Tailwind's scanner can see every one. */
const TINTS = {
  tomato: { icon: "text-tomato", glow: "from-tomato/10" },
  amber: { icon: "text-amber-700 dark:text-amber", glow: "from-amber/10" },
  leaf: { icon: "text-leaf-700 dark:text-leaf", glow: "from-leaf/10" },
} as const;

function Figure({
  label,
  value,
  decimals = 0,
  icon: Icon,
  tint,
}: {
  label: string;
  /** `null` means "no data", which is a different thing from zero. */
  value: number | null;
  decimals?: 0 | 1;
  icon: typeof Star;
  tint: keyof typeof TINTS;
}) {
  // Hooks can't be conditional, so the animation always runs — it just runs
  // towards 0 for a missing value, and the em dash is rendered instead.
  const animated = useCountUp(value ?? 0);
  const { icon, glow } = TINTS[tint];

  return (
    <div className="relative overflow-hidden rounded-3xl border border-line bg-surface px-3 py-4 text-center sm:px-4">
      {/* A tint that fades out downwards, so the colour reads as light on the
          tile rather than as a coloured tile. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 bg-gradient-to-b to-transparent ${glow}`}
      />
      <div className="relative">
        <Icon className={`mx-auto mb-1.5 h-4 w-4 ${icon}`} aria-hidden />
        <p className="font-serif text-2xl font-semibold tabular-nums leading-none text-fg sm:text-3xl">
          {value == null ? "—" : animated.toFixed(decimals)}
        </p>
        <p className="mt-1.5 text-[0.7rem] uppercase tracking-wide text-muted">{label}</p>
      </div>
    </div>
  );
}
