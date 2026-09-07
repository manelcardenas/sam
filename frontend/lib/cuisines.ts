import { Leaf } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * A colour per cuisine, so the archive is scannable by kind without photographs.
 *
 * **Why colour and not icons** (docs/plans/ux-refresh-plan.md §6): two of the
 * twelve tags have no honest glyph — "Other" is a category of last resort and
 * "Vegan/Vegetarian" is a diet, not a place — and the three tags carrying the
 * most restaurants (Chinese 10, Mediterranean 6, Spanish 6) share essentially
 * every available food glyph, so an icon would do the least work exactly where
 * the data is densest. Colour covers all twelve and reads at chip size.
 *
 * **Why a hardcoded map is safe.** The vocabulary is closed: twelve rows seeded
 * in migration `874c491875f4`, `GET /cuisines` is read-only, and the API
 * rejects unknown tags. It cannot go stale without a migration — and if one
 * ever adds a thirteenth, `cuisineAccent` falls back to a neutral rather than
 * throwing or rendering nothing.
 *
 * **The label always carries the meaning.** Colour is never the only signal.
 * That is an accessibility rule, but it is also just true: twelve pairwise
 * distinct hues is more than the eye reliably resolves at 8px, so these
 * accelerate recognition of the tags you meet often and merely decorate the
 * rest. Chinese and Mexican are the closest pair, which is tolerable because
 * one has ten restaurants and the other has one.
 */
const ACCENTS: Record<string, string> = {
  Chinese: "#A8322B", // oxblood
  Spanish: "#E8901B", // amber
  Mediterranean: "#2F8B84", // teal — the sea
  Italian: "#6E9244", // olive
  Japanese: "#D4688A", // blossom
  Mexican: "#E4572E", // tomato
  Thai: "#7C6BB5", // violet
  Indian: "#B25E17", // burnt orange
  French: "#5A7FA8", // slate blue
  American: "#8C6239", // leather
  "Vegan/Vegetarian": "#4E9E63", // green
  // "Other" is deliberately absent: a catch-all should look like a catch-all,
  // so it takes the neutral fallback below.
};

/** The one cuisine where a glyph genuinely means something. */
const ICONS: Record<string, LucideIcon> = {
  "Vegan/Vegetarian": Leaf,
};

/** Falls back to the theme's muted tone for "Other" and anything unrecognised. */
export function cuisineAccent(name: string): string {
  return ACCENTS[name] ?? "rgb(var(--muted))";
}

export function cuisineIcon(name: string): LucideIcon | null {
  return ICONS[name] ?? null;
}
