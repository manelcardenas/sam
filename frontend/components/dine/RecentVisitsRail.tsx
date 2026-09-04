"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { RestaurantDetail } from "@/lib/api-client";
import { formatRelativeDate, formatReviewers } from "@/lib/format";
import { PriceLevel, QuoteBlock, ScoreBadge, quoteAttribution } from "@/components/dine/atoms";

/** Below this, a rail of "recent" visits is indistinguishable from the grid under it. */
const MIN_TO_SHOW = 4;
const MAX_CARDS = 8;

/**
 * "Lately" — a horizontal reel of the most recent visits, sitting above the
 * archive grid.
 *
 * Why a rail and not just more grid: the two surfaces answer different questions.
 * The rail is for savouring what you've been up to lately (few items, large,
 * swipeable); the grid is for finding something among everything (many items,
 * dense, filterable). A single carousel holding all 24 would be worse at both.
 *
 * Accessibility, because snap rails are a classic keyboard trap:
 *  - a labelled region, so it is announced and navigable as a landmark
 *  - every card is a real button, so Tab walks them and the browser scrolls to keep
 *    focus visible — no manual scrollIntoView needed
 *  - Left/Right arrows scroll by one card when focus is inside the rail
 *  - desktop prev/next buttons, because a swipe affordance is invisible to a mouse
 *    and they are aria-hidden from the tab order the arrows already cover
 */
export function RecentVisitsRail({
  restaurants,
  onSelect,
}: {
  restaurants: RestaurantDetail[];
  onSelect: (restaurant: RestaurantDetail) => void;
}) {
  const scrollerRef = useRef<HTMLUListElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  // Sorted here rather than trusting the caller: this rail promises recency by
  // name, and the list it is handed can be ordered by rating instead.
  const recent = useMemo(
    () =>
      restaurants
        .filter((r) => r.last_visited_at)
        .sort((a, b) => (a.last_visited_at! < b.last_visited_at! ? 1 : -1))
        .slice(0, MAX_CARDS),
    [restaurants],
  );

  const syncEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 1);
    // -1 for sub-pixel rounding at the end of a scroll.
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    syncEdges();
    const el = scrollerRef.current;
    if (!el) return;
    // Re-check on resize: a viewport change can remove the overflow entirely.
    const observer = new ResizeObserver(syncEdges);
    observer.observe(el);
    return () => observer.disconnect();
  }, [syncEdges, recent.length]);

  const scrollByCard = useCallback((direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>("li");
    // Fall back to ~80% of the viewport when there is no card to measure.
    const step = card ? card.offsetWidth + 16 : el.clientWidth * 0.8;
    el.scrollBy({ left: direction * step, behavior: "smooth" });
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      scrollByCard(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      scrollByCard(-1);
    }
  };

  if (recent.length < MIN_TO_SHOW) return null;

  return (
    <section aria-labelledby="lately-heading" className="mb-8">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2
            id="lately-heading"
            className="font-serif text-xl font-semibold italic text-fg sm:text-2xl"
          >
            Lately
          </h2>
          <p className="text-sm text-muted">Where the pack has been eating.</p>
        </div>

        <div className="hidden shrink-0 items-center gap-1 sm:flex" aria-hidden>
          <RailButton onClick={() => scrollByCard(-1)} disabled={atStart} label="Scroll left">
            <ChevronLeft className="h-4 w-4" />
          </RailButton>
          <RailButton onClick={() => scrollByCard(1)} disabled={atEnd} label="Scroll right">
            <ChevronRight className="h-4 w-4" />
          </RailButton>
        </div>
      </div>

      <ul
        ref={scrollerRef}
        onScroll={syncEdges}
        onKeyDown={onKeyDown}
        // scroll-pl-4 must match px-4, and is not redundant with it: snap-start
        // aligns a card to the *scrollport* edge (the padding box, x=0), not the
        // content edge. Without scroll-padding, snap-mandatory scrolls the rail
        // 16px at load to satisfy that, cancelling the px-4 and leaving the first
        // card flush to the screen edge while every other element on the page sits
        // inset by 16px. scroll-padding is what actually moves the snap points.
        //
        // A scrollable region needs a tabindex to be reachable by keyboard users
        // who don't tab into a child first.
        tabIndex={0}
        role="list"
        aria-label="Recent visits"
        className="rail-scroll -mx-4 flex snap-x snap-mandatory scroll-pl-4 gap-4 overflow-x-auto px-4 pb-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/40 sm:mx-0 sm:scroll-pl-0 sm:px-0"
      >
        {recent.map((r, i) => (
          <li
            key={r.id}
            className="will-fetch animate-fetch-in w-[16.5rem] shrink-0 snap-start sm:w-[18rem]"
            style={{ animationDelay: `${Math.min(i, 5) * 45}ms` }}
          >
            <RailCard restaurant={r} onClick={() => onSelect(r)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RailButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      // Not in the tab order: the rail's own arrow-key handling already covers
      // keyboard users, and these would otherwise add two stops before every card.
      tabIndex={-1}
      className="grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-line bg-surface text-muted transition-colors hover:border-tomato/40 hover:text-tomato disabled:cursor-default disabled:opacity-35 disabled:hover:border-line disabled:hover:text-muted"
    >
      {children}
    </button>
  );
}

/**
 * A visit as a ticket stub: the score and price on the "counter" strip, the
 * quote in the body, and a perforated bottom edge (.ticket-edge) so a saved
 * meal reads as something kept rather than a rectangle.
 */
function RailCard({
  restaurant: r,
  onClick,
}: {
  restaurant: RestaurantDetail;
  onClick: () => void;
}) {
  const reviewers = formatReviewers(r.reviewer_names);
  const attribution = quoteAttribution({
    reviewerNames: r.reviewer_names,
    lastCommentBy: r.last_comment_by,
    lastCommentAt: r.last_comment_at,
    lastVisitedAt: r.last_visited_at,
  });

  return (
    <article className="group relative h-full">
      <div className="ticket-edge flex h-full min-w-0 flex-col rounded-3xl rounded-b-none border border-b-0 border-line bg-surface pb-4 transition-[border-color,box-shadow] duration-200 group-hover:border-tomato/40 group-hover:shadow-paw">
        <div className="flex items-start gap-3 border-b border-dashed border-line px-4 py-3.5">
          <ScoreBadge score={r.average_overall} size="lg" />
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-[0.95rem] font-semibold leading-snug text-fg transition-colors group-hover:text-tomato">
              <button
                type="button"
                onClick={onClick}
                className="block w-full cursor-pointer text-left focus:outline-none after:absolute after:inset-0 after:rounded-3xl focus-visible:after:ring-2 focus-visible:after:ring-tomato/50"
              >
                <span className="line-clamp-2">{r.name}</span>
              </button>
            </h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[0.7rem] uppercase tracking-wide text-muted">
              {r.cuisines.length > 0 && <span className="truncate">{r.cuisines[0]}</span>}
              {r.price_level && <PriceLevel level={r.price_level} className="text-[0.7rem]" />}
            </p>
          </div>
        </div>

        <div className="flex-1 px-4 pt-3.5">
          {r.last_comment ? (
            <QuoteBlock
              comment={r.last_comment}
              by={attribution.by}
              when={attribution.showDate && r.last_comment_at ? formatRelativeDate(r.last_comment_at) : null}
              lines={3}
            />
          ) : (
            <p className="text-sm italic text-muted">No notes from this one.</p>
          )}
        </div>

        <p className="mt-3 flex min-w-0 items-baseline gap-2 px-4 text-[0.7rem] text-muted">
          {reviewers && <span className="min-w-0 truncate">{reviewers}</span>}
          {r.last_visited_at && (
            <span className="ml-auto shrink-0 whitespace-nowrap font-medium">
              {formatRelativeDate(r.last_visited_at)}
            </span>
          )}
        </p>
      </div>
    </article>
  );
}
