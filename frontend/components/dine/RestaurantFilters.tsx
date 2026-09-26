"use client";

import { Search, UtensilsCrossed } from "lucide-react";
import { AuthorSelect } from "@/components/ui/AuthorSelect";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { Chip, ClearChip } from "@/components/ui/Chip";
import { cuisineAccent, cuisineIcon } from "@/lib/cuisines";
import { SortControl } from "@/components/dine/SortControl";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import type { MessageKey } from "@/lib/i18n/dictionary";
import { youFirstThenByName, type PersonOption } from "@/lib/people";
import type { RestaurantDetail, RestaurantQuery, RestaurantSort } from "@/lib/api-client";

// Every ordering the UI can produce, for guarding ?sort= off the URL.
const SORTS: RestaurantSort[] = ["recent", "oldest", "rating", "rating_low"];

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
  /** Reviewer ids, OR-ed together. Empty means "anyone" — the recipe filter's rule. */
  reviewers: string[];
  sort: RestaurantSort;
}

export const DEFAULT_SORT: RestaurantSort = "recent";

export const EMPTY_FILTERS: FilterState = {
  q: "",
  cuisines: [],
  priceLevels: [],
  reviewers: [],
  sort: DEFAULT_SORT,
};

export function isFiltered(f: FilterState): boolean {
  return Boolean(f.q.trim() || f.cuisines.length || f.priceLevels.length || f.reviewers.length);
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
    reviewers: f.reviewers,
    sort: f.sort,
  };
}

/** Serialise to the URL so a filtered view is shareable and survives a refresh. */
export function toSearchParams(f: FilterState): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  f.cuisines.forEach((c) => p.append("cuisine", c));
  f.priceLevels.forEach((n) => p.append("price", String(n)));
  f.reviewers.forEach((id) => p.append("reviewer", id));
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
    // An id that matches nobody is harmless — it narrows to nothing the API
    // can find, and the dropdown shows no name for it — so no guard is needed.
    // The old `?mine=1` is dropped rather than translated: nobody's id is
    // known while the URL is being read.
    reviewers: params.getAll("reviewer"),
    // Guard the URL the same way as ?price: an unknown ordering falls back to
    // the default rather than reaching the API and 422-ing the whole page.
    sort: SORTS.includes(params.get("sort") as RestaurantSort)
      ? (params.get("sort") as RestaurantSort)
      : DEFAULT_SORT,
  };
}

/**
 * The people who have reviewed something in the archive, for "Reviewed by".
 *
 * Derived from the loaded list, like the recipe authors, so nobody who has
 * reviewed nothing can be offered. Empty when the control could only select the
 * whole list — one reviewer, and every place reviewed — which is the Bebida dead
 * end again. One reviewer alongside unreviewed places still narrows, so it stays:
 * that is exactly the old "Reviewed by me".
 */
export function reviewersOf(archive: RestaurantDetail[], currentUserId: string | null, locale: string): PersonOption[] {
  const byId = new Map<string, string>();
  // `?? []`: a list served by a backend older than this field must still render.
  for (const restaurant of archive) {
    for (const person of restaurant.reviewers ?? []) byId.set(person.id, person.display_name);
  }
  if (byId.size === 1 && archive.every((r) => (r.reviewers ?? []).length > 0)) return [];
  return youFirstThenByName(
    [...byId].map(([id, name]) => ({ id, name })),
    currentUserId,
    locale,
  );
}

/**
 * A cuisine's own colour, so the list is scannable before you read it
 * (docs/plans/ux-refresh-plan.md §6). On a ticked row the mark sits on tomato,
 * where the accent would have poor contrast, so it flips to white. Decorative
 * either way — the name is right beside it.
 */
function CuisineMark({ name, on }: { name: string; on: boolean }) {
  const Icon = cuisineIcon(name);
  if (Icon) return <Icon className="h-3.5 w-3.5" style={on ? undefined : { color: cuisineAccent(name) }} />;
  return (
    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: on ? "currentColor" : cuisineAccent(name) }} />
  );
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
  reviewers,
  currentUserId,
  onChange,
  resultCount,
  busy,
}: {
  value: FilterState;
  /** From `reviewersOf` — empty hides "Reviewed by". */
  reviewers: PersonOption[];
  currentUserId: string | null;
  /** Only cuisines actually in use — an empty option is a dead end — most used first. */
  cuisines: { name: string; count: number }[];
  /** Only price levels actually in use, same reason. */
  priceLevels: number[];
  onChange: (next: FilterState) => void;
  resultCount: number;
  busy: boolean;
}) {
  const { t, tp } = useI18n();
  const active = isFiltered(value);

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
          placeholder={t("dine-filters.search-placeholder")}
          aria-label={t("dine-filters.search-label")}
          className="h-12 w-full rounded-2xl border border-line bg-surface pl-11 pr-4 text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30"
        />
      </div>

      {/* Narrowing and ordering share one line (docs/plans/ux-refresh-plan.md
          §5). The sort control is a sibling of the scroller, not a child: put
          inside it, it would scroll away with the chips. */}
      <div className="flex items-start gap-2">
        {/* One line: two dropdowns and four price chips. Cuisines used to be
            ~10 chips here, which ran three screens wide on a phone and pushed
            the price chips out of sight — hence the dropdown (see
            `MultiSelect`). It still scrolls sideways if a narrow screen needs
            it; the negative margin bleeds it to the left edge so it reads as
            scrollable, and the right edge is the sort control. */}
        <div className="rail-scroll -ml-4 flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto pl-4 sm:ml-0 sm:flex-wrap sm:overflow-visible sm:pl-0">
          {/* Leads the row, labelled, exactly as "Created by" does on the
              recipe lists: whose places before what kind. */}
          {reviewers.length > 0 && (
            <>
              <AuthorSelect
                label={t("dine-filters.reviewed-by")}
                authors={reviewers}
                selected={value.reviewers}
                onChange={(next) => onChange({ ...value, reviewers: next })}
                currentUserId={currentUserId}
              />
              {(cuisines.length > 0 || priceLevels.length > 0) && (
                <span className="mx-0.5 h-5 w-px shrink-0 self-center bg-line" aria-hidden />
              )}
            </>
          )}

          {cuisines.length > 0 && (
            <>
              <MultiSelect
                label={t("dine-filters.cuisine")}
                icon={UtensilsCrossed}
                options={cuisines.map(({ name, count }) => ({
                  id: name,
                  name: t(`cuisines.${name}` as MessageKey),
                  mark: (on) => <CuisineMark name={name} on={on} />,
                  count,
                }))}
                selected={value.cuisines}
                onChange={(next) => onChange({ ...value, cuisines: next })}
                manyLabel={(n) => tp("dine-filters.cuisines-count", n)}
              />
              {priceLevels.length > 0 && (
                <span className="mx-0.5 h-5 w-px shrink-0 self-center bg-line" aria-hidden />
              )}
            </>
          )}

          {priceLevels.map((level) => (
            <Chip
              key={level}
              active={value.priceLevels.includes(level)}
              onClick={() => togglePrice(level)}
              label={t("dine-filters.price-level", { level })}
            >
              <span aria-hidden>{"€".repeat(level)}</span>
            </Chip>
          ))}

          {active && <ClearChip onClick={() => onChange(clearFilters(value))} />}
        </div>

        <SortControl
          value={value.sort}
          onChange={(sort) => onChange({ ...value, sort })}
        />
      </div>

      {/* Live region so the result count reaches screen readers when chips change
          the list without moving focus. aria-busy suppresses announcements
          mid-fetch, which would otherwise read a stale count. */}
      <p className="sr-only" role="status" aria-live="polite" aria-busy={busy}>
        {busy ? t("dine-filters.updating") : tp("dine-filters.results", resultCount)}
      </p>
    </div>
  );
}
