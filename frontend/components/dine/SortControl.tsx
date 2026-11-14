"use client";

import { ArrowDownWideNarrow } from "lucide-react";
import type { RestaurantSort } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import type { MessageKey } from "@/lib/i18n/dictionary";

/**
 * The orderings offered in the UI, in the order they appear.
 *
 * `name` exists on the API but is only used by the dedup lookup. The four here
 * are named rather than being two keys plus an ascending/descending toggle —
 * one control instead of two, plain language instead of an abstract direction,
 * and each maps to an ordering the repository sorts deliberately. Crucially the
 * two reverse orderings are *not* mirror images: unrated and never-visited
 * restaurants stay at the bottom of all four, because "no score" is not "the
 * worst score" (docs/plans/ux-refresh-plan.md §5).
 */
const OPTIONS: RestaurantSort[] = ["recent", "oldest", "rating", "rating_low"];

/**
 * How the archive is ordered.
 *
 * **Sits inline at the end of the filter row, pinned outside its scroller.**
 * It used to own a full-width row of its own below a divider, which is a lot of
 * vertical space on a 390px screen for a control most people set once. It must
 * not sit *inside* the `rail-scroll` container or it scrolls away with the
 * chips — that is the one real layout trap here.
 *
 * **On a phone it is its icon; from `sm` it spells the current ordering.**
 * It used to spell it everywhere, and at 360 px "Visitados hace poco" took 200
 * of the row's 328 px, so the filters beside it were cut mid-word
 * ("Reseñado po|"). Below `sm` the select's own text is made transparent and
 * the control shrinks to a 44 px square around the icon; the select is still
 * the whole hit area, and a screen reader still reads its value. What the
 * phone loses — reading the order without a tap — is half given back: the
 * icon turns tomato whenever the order is not the default, so "this list is
 * sorted unusually" stays visible.
 *
 * Still a native `<select>`, and deliberately so: iOS renders its wheel picker
 * (genuinely better one-handed than any menu we would build), keyboard and
 * screen-reader behaviour come for free, and it stays correct as options are
 * added — a "Closest" sort would be one more entry in OPTIONS. Whether a bottom
 * sheet would beat it is a real question, and it belongs to the interaction
 * research (§7) rather than being guessed at here.
 *
 * `rounded-2xl`, not `rounded-full`, on purpose: the app uses fully-round pills
 * for things that toggle and rounded rectangles for things that hold a value.
 * Sitting directly beside the chips, the shape is what tells them apart.
 */
export function SortControl({
  value,
  onChange,
  className = "",
}: {
  value: RestaurantSort;
  onChange: (next: RestaurantSort) => void;
  className?: string;
}) {
  const { t } = useI18n();
  // OPTIONS[0] is DEFAULT_SORT (importing it from RestaurantFilters would be a cycle).
  const unusual = value !== OPTIONS[0];

  return (
    <div className={`relative shrink-0 ${className}`}>
      <ArrowDownWideNarrow
        className={`pointer-events-none absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 sm:left-3 sm:translate-x-0 ${
          unusual ? "text-tomato" : "text-muted"
        }`}
        aria-hidden
      />
      <select
        aria-label={t("sort.label")}
        title={t(`sort.${value}` as MessageKey)}
        value={value}
        onChange={(e) => onChange(e.target.value as RestaurantSort)}
        // h-11 = 44px, matching the chips it sits beside. Phone: a 44 px
        // square, text transparent (the options keep theirs). From sm: the
        // value, with pl-9/pr-8 leaving room for the two layered icons.
        className={`h-11 w-11 cursor-pointer appearance-none rounded-2xl border bg-surface text-sm font-semibold text-transparent transition-colors *:text-fg hover:border-tomato/40 focus:border-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/40 sm:w-auto sm:pl-9 sm:pr-8 sm:text-fg ${
          unusual ? "border-tomato/60" : "border-line"
        }`}
      >
        {OPTIONS.map((option) => (
          <option key={option} value={option}>
            {t(`sort.${option}` as MessageKey)}
          </option>
        ))}
      </select>
      <ChevronDown />
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
      className="pointer-events-none absolute right-2.5 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-muted sm:block"
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
