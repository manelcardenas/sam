"use client";

import { ArrowDownWideNarrow } from "lucide-react";
import type { RestaurantSort } from "@/lib/api-client";

/** The orderings offered in the UI. `name` exists on the API but is only used by the dedup lookup. */
const OPTIONS: { value: RestaurantSort; label: string }[] = [
  { value: "recent", label: "Recently visited" },
  { value: "rating", label: "Top rated" },
];

/**
 * How the archive is ordered.
 *
 * Deliberately a native `<select>`, not a third segmented control. The page
 * already has two — outlined filter chips (which *narrow*) and the Cards/Map
 * switch (which *changes the medium*) — and a third one styled the same way
 * would read as another filter, i.e. "show me only the top-rated ones". A
 * dropdown reads as picking one ordering out of several, which is what this is.
 *
 * Native rather than a custom listbox because the native control wins on every
 * axis that matters here: iOS renders its wheel picker (genuinely better
 * one-handed than any menu we would build), keyboard and screen-reader
 * behaviour come for free, and it stays correct when "Closest" is added later
 * — the roadmap's deferred distance sort plugs in as one more entry in OPTIONS.
 *
 * `rounded-2xl`, not `rounded-full`, on purpose: the page uses fully-round pills
 * for toggles (the filter chips) and rounded rectangles for controls that hold a
 * value (the search input). At rest this select is otherwise pixel-close to an
 * inactive chip, and the shape is what tells them apart at a glance.
 *
 * `appearance-none` plus our own chevron keeps it visually in the system; the
 * label is real and associated, not a placeholder option.
 */
export function SortControl({
  value,
  onChange,
}: {
  value: RestaurantSort;
  onChange: (next: RestaurantSort) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <label
        htmlFor="dine-sort"
        className="flex shrink-0 items-center gap-1.5 text-sm text-muted"
      >
        <ArrowDownWideNarrow className="h-4 w-4 shrink-0" aria-hidden />
        {/* The word is redundant with the icon on a phone, where space is the
            scarcer resource — the icon plus the option text still reads. */}
        <span className="hidden sm:inline">Order</span>
      </label>

      <div className="relative min-w-0">
        <select
          id="dine-sort"
          value={value}
          onChange={(e) => onChange(e.target.value as RestaurantSort)}
          // h-11 = 44px. pr-9 leaves room for the chevron sitting over the control.
          className="h-11 w-full cursor-pointer appearance-none truncate rounded-2xl border border-line bg-surface pl-3.5 pr-9 text-sm font-semibold text-fg transition-colors hover:border-tomato/40 focus:border-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/40"
        >
          {OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown />
      </div>
    </div>
  );
}

/** Our own chevron, since `appearance-none` removes the platform one. */
function ChevronDown() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
    >
      <path
        d="M5 7.5 10 12.5 15 7.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
