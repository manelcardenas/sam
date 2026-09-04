"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import type { RestaurantQuery, RestaurantSort } from "@/lib/api-client";

const SORTS: RestaurantSort[] = ["recent", "rating"];

/**
 * The dine list's query state: what to include, and in what order.
 *
 * `sort` rides along in the same object so one debounced effect drives one
 * request — but it is deliberately *not* part of `isFiltered`. Sorting doesn't
 * narrow anything, so it must not flip the heading to "Matching", must not
 * light up the Clear affordance, and must survive a Clear (see `clearFilters`).
 */
export interface FilterState {
  q: string;
  cuisines: string[];
  priceLevels: number[];
  mine: boolean;
  sort: RestaurantSort;
}

export const DEFAULT_SORT: RestaurantSort = "recent";

export const EMPTY_FILTERS: FilterState = {
  q: "",
  cuisines: [],
  priceLevels: [],
  mine: false,
  sort: DEFAULT_SORT,
};

export function isFiltered(f: FilterState): boolean {
  return Boolean(f.q.trim() || f.cuisines.length || f.priceLevels.length || f.mine);
}

/** Clearing narrows nothing back to everything — but keeps the chosen ordering. */
export function clearFilters(f: FilterState): FilterState {
  return { ...EMPTY_FILTERS, sort: f.sort };
}

export function toQuery(f: FilterState): RestaurantQuery {
  return {
    q: f.q.trim() || undefined,
    cuisines: f.cuisines,
    priceLevels: f.priceLevels,
    mine: f.mine,
    sort: f.sort,
  };
}

/** Serialise to the URL so a filtered view is shareable and survives a refresh. */
export function toSearchParams(f: FilterState): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  f.cuisines.forEach((c) => p.append("cuisine", c));
  f.priceLevels.forEach((n) => p.append("price", String(n)));
  if (f.mine) p.set("mine", "1");
  if (f.sort !== DEFAULT_SORT) p.set("sort", f.sort);
  return p.toString();
}

export function fromSearchParams(params: URLSearchParams): FilterState {
  return {
    q: params.get("q") ?? "",
    cuisines: params.getAll("cuisine"),
    // Guard the URL: a hand-edited ?price=abc must not reach the API as NaN.
    priceLevels: params
      .getAll("price")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 4),
    mine: params.get("mine") === "1",
    // Guard the URL the same way as ?price: an unknown ordering falls back to
    // the default rather than reaching the API and 422-ing the whole page.
    sort: SORTS.includes(params.get("sort") as RestaurantSort)
      ? (params.get("sort") as RestaurantSort)
      : DEFAULT_SORT,
  };
}

/**
 * The narrowing controls for the archive.
 *
 * Filters rather than a search engine, deliberately: at this corpus size a
 * ranked fuzzy search has nothing to rank, while cuisine is lopsided enough
 * that chips pay off immediately (docs/adr/0005).
 *
 * Every control is >=44px tall — these are the first thumb-sized targets in the
 * app, and chips are exactly the kind of thing that gets built at 28px and is
 * then unusable one-handed on a phone.
 */
export function RestaurantFilters({
  value,
  cuisines,
  priceLevels,
  onChange,
  resultCount,
  busy,
}: {
  value: FilterState;
  /** Only cuisines actually in use — an empty chip is a dead end. */
  cuisines: string[];
  /** Only price levels actually in use, same reason. */
  priceLevels: number[];
  onChange: (next: FilterState) => void;
  resultCount: number;
  busy: boolean;
}) {
  const active = isFiltered(value);

  const toggleCuisine = (name: string) =>
    onChange({
      ...value,
      cuisines: value.cuisines.includes(name)
        ? value.cuisines.filter((c) => c !== name)
        : [...value.cuisines, name],
    });

  const togglePrice = (level: number) =>
    onChange({
      ...value,
      priceLevels: value.priceLevels.includes(level)
        ? value.priceLevels.filter((p) => p !== level)
        : [...value.priceLevels, level],
    });

  return (
    <div className="mb-5">
      <div className="relative mb-3">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          type="search"
          value={value.q}
          onChange={(e) => onChange({ ...value, q: e.target.value })}
          placeholder="Search by name…"
          aria-label="Search restaurants by name"
          className="h-12 w-full rounded-2xl border border-line bg-surface pl-11 pr-4 text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30"
        />
      </div>

      {/* One swipeable line on phones, wrapping on wider screens: with ~10
          cuisines in play, wrapping on a 390px viewport buries the list under
          four rows of chips before any content appears. The negative margin
          lets it bleed to the screen edge so the row reads as scrollable. */}
      <div className="rail-scroll -mx-4 flex flex-nowrap items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        <Chip active={value.mine} onClick={() => onChange({ ...value, mine: !value.mine })}>
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
          Reviewed by me
        </Chip>

        {cuisines.map((name) => (
          <Chip key={name} active={value.cuisines.includes(name)} onClick={() => toggleCuisine(name)}>
            {name}
          </Chip>
        ))}

        {priceLevels.map((level) => (
          <Chip
            key={level}
            active={value.priceLevels.includes(level)}
            onClick={() => togglePrice(level)}
            label={`Price level ${level} of 4`}
          >
            <span aria-hidden>{"€".repeat(level)}</span>
          </Chip>
        ))}

        {active && (
          <button
            type="button"
            onClick={() => onChange(clearFilters(value))}
            className="flex h-11 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-semibold text-muted underline-offset-4 transition-colors hover:text-tomato hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Clear
          </button>
        )}
      </div>

      {/* Live region so the result count reaches screen readers when chips change
          the list without moving focus. aria-busy suppresses announcements
          mid-fetch, which would otherwise read a stale count. */}
      <p className="sr-only" role="status" aria-live="polite" aria-busy={busy}>
        {busy ? "Updating results" : `${resultCount} restaurant${resultCount === 1 ? "" : "s"}`}
      </p>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
  label,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      // h-11 = 44px: the minimum comfortable touch target.
      className={`flex h-11 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 ${
        active
          ? "border-tomato bg-tomato text-white shadow-pop"
          : "border-line bg-surface text-muted hover:border-tomato/40 hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}
