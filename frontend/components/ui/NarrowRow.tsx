"use client";

import { Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import type { PluralKey } from "@/lib/i18n/dictionary";

/**
 * Search box plus an optional row of chips, for a list that narrows.
 *
 * §1b of the UX plan: the profile had two unbounded lists with no filter, no
 * search and no pagination — the problem `/dine` had already solved next door.
 * This is that solution, reused rather than reinvented, down to the chip row
 * bleeding to the screen edge so it reads as scrollable on a phone. §2 made
 * `/dashboard` the third caller when its category grid became chips.
 *
 * `/dine` keeps its own richer filter component: it narrows on four axes at
 * once and owns the URL serialisation for all of them, which is a different
 * job from "one search box and a row of toggles".
 *
 * The live region matters more here than it looks: typing changes the list
 * without moving focus, so without it a screen-reader user gets no feedback at
 * all that anything happened.
 */
export function NarrowRow({
  q,
  onQueryChange,
  placeholder,
  ariaLabel,
  chips,
  resultCount,
  countKey,
}: {
  q: string;
  onQueryChange: (next: string) => void;
  placeholder: string;
  ariaLabel: string;
  /** Rendered as-is; callers compose `Chip`/`ClearChip` themselves. */
  chips?: React.ReactNode;
  resultCount: number;
  /**
   * Plural key for the live-region announcement.
   *
   * A key rather than a noun the caller pluralises: "3 recipes" is one string
   * per language, not a noun plus an English "s" — Catalan and Spanish agree
   * with English here, but building the sentence out of parts is how that stops
   * being true the moment a fourth language arrives.
   */
  countKey: PluralKey;
}) {
  const { tp } = useI18n();

  return (
    <div className="mb-5">
      <div className="relative mb-3">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          type="search"
          value={q}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className="h-12 w-full rounded-2xl border border-line bg-surface pl-11 pr-4 text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30"
        />
      </div>

      {chips && (
        <div className="rail-scroll -mx-4 flex flex-nowrap items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {chips}
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {tp(countKey, resultCount)}
      </p>
    </div>
  );
}
