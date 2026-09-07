"use client";

import { Search } from "lucide-react";

/**
 * Search box plus an optional row of chips, for the profile's two lists.
 *
 * §1b of the UX plan: the profile had two unbounded lists with no filter, no
 * search and no pagination — the problem `/dine` had already solved next door.
 * This is that solution, reused rather than reinvented, down to the chip row
 * bleeding to the screen edge so it reads as scrollable on a phone.
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
  noun,
}: {
  q: string;
  onQueryChange: (next: string) => void;
  placeholder: string;
  ariaLabel: string;
  /** Rendered as-is; callers compose `Chip`/`ClearChip` themselves. */
  chips?: React.ReactNode;
  resultCount: number;
  /** Singular noun for the announcement, e.g. "recipe". */
  noun: string;
}) {
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
        {resultCount} {noun}
        {resultCount === 1 ? "" : "s"}
      </p>
    </div>
  );
}
