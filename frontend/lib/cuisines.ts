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

/**
 * The neutral a pin takes for "Other", an untagged place, or anything unknown.
 * A fixed colour rather than `--muted`: the basemap is light in both themes, and
 * dark mode's muted is a pale beige that white text disappears into.
 */
const NEUTRAL_PIN = "#635E54";
const WHITE = "#FFFFFF";
const INK = "#1A1A1A";

/**
 * What a map pin is painted with: the colour of the restaurant's first cuisine —
 * the same one the first dot on its card shows — and whichever text colour
 * stays readable on it.
 *
 * **One colour, not a split pin.** A place tagged Chinese and Mediterranean
 * could show both, but the score sits across the middle of the pin, so half of
 * it would be on each colour, at two different contrasts. The slide-up card
 * names every cuisine; the pin only has to be recognisable.
 *
 * **White unless white fails.** White text keeps the pins looking like one set.
 * It only gives way where it drops below 3:1 — the bold-UI floor, and what the
 * old tomato pin cleared at 3.7:1 — which today is Spanish's amber alone (2.5:1,
 * against 7:1 for ink). Computed rather than listed, so a recoloured cuisine
 * cannot quietly become unreadable.
 */
export function pinColors(cuisines: string[]): { background: string; ink: string } {
  const background = (cuisines[0] && ACCENTS[cuisines[0]]) || NEUTRAL_PIN;
  return { background, ink: contrast(background, WHITE) >= 3 ? WHITE : INK };
}

/** WCAG contrast ratio between two `#RRGGBB` colours. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
