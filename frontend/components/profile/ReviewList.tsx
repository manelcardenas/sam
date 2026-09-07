"use client";

import { MessageSquareQuote, SearchX } from "lucide-react";
import { Chip, ClearChip } from "@/components/ui/Chip";
import { NarrowRow } from "@/components/ui/NarrowRow";
import { EmptyPanel } from "@/components/profile/EmptyPanel";
import { QuoteBlock, ScoreBadge } from "@/components/dine/atoms";
import { formatRelativeDate, formatVisitedDate } from "@/lib/format";
import { REVIEW_SORTS, type ReviewSort } from "@/lib/profile-url";
import type { UserReview } from "@/lib/api-client";

const SORT_LABELS: Record<ReviewSort, string> = {
  recent: "Most recent",
  score: "Highest rated",
};

/**
 * Your reviews, narrowable by restaurant name and re-orderable.
 *
 * Cards open `/dine?place=<restaurant_id>`. The old page pushed a bare
 * `/dine`, which dropped you at the top of the archive and left you to find
 * the place again — a real bug rather than a design choice, and the review has
 * carried `restaurant_id` all along.
 *
 * Ordering is two named options rather than a key plus a direction toggle, for
 * the reason argued in §5 of the UX plan: "oldest first" and "worst rated" are
 * real but rare, and naming the orderings you want beats offering the
 * cross-product of the ones you don't.
 */
export function ReviewList({
  reviews,
  q,
  sort,
  onQueryChange,
  onSortChange,
  onOpen,
  onFindPlaces,
}: {
  reviews: UserReview[];
  q: string;
  sort: ReviewSort;
  onQueryChange: (next: string) => void;
  onSortChange: (next: ReviewSort) => void;
  onOpen: (review: UserReview) => void;
  onFindPlaces: () => void;
}) {
  const needle = q.trim().toLowerCase();
  const shown = reviews
    .filter((r) => !needle || r.restaurant_name.toLowerCase().includes(needle))
    // Sorted on a copy: `reviews` is the state array, and sorting in place
    // mutates it, which React is entitled not to notice.
    .slice()
    .sort((a, b) =>
      sort === "score"
        ? b.overall - a.overall || b.visited_at.localeCompare(a.visited_at)
        : b.visited_at.localeCompare(a.visited_at),
    );

  if (reviews.length === 0) {
    return (
      <EmptyPanel
        icon={<MessageSquareQuote className="mx-auto mb-3 h-8 w-8 text-muted" aria-hidden />}
        title="No reviews yet."
        body="Every place you write up lands here, with what you said about it."
        actionLabel="Find somewhere to eat"
        onAction={onFindPlaces}
      />
    );
  }

  return (
    <>
      <NarrowRow
        q={q}
        onQueryChange={onQueryChange}
        placeholder="Search the places you've reviewed…"
        ariaLabel="Search your reviews by restaurant name"
        resultCount={shown.length}
        noun="review"
        chips={
          <>
            {REVIEW_SORTS.map((option) => (
              <Chip key={option} active={sort === option} onClick={() => onSortChange(option)}>
                {SORT_LABELS[option]}
              </Chip>
            ))}
            {needle && <ClearChip onClick={() => onQueryChange("")} />}
          </>
        }
      />

      {shown.length === 0 ? (
        <EmptyPanel
          icon={<SearchX className="mx-auto mb-3 h-8 w-8 text-muted" aria-hidden />}
          title="Nothing matches that."
          body="Try a shorter word — this only searches the restaurant's name."
          actionLabel="Clear"
          onAction={() => onQueryChange("")}
        />
      ) : (
        <ul className="space-y-3">
          {shown.map((review, i) => (
            <li
              key={review.id}
              className={i < 8 ? "will-fetch animate-fetch-in" : undefined}
              style={i < 8 ? { animationDelay: `${i * 40}ms` } : undefined}
            >
              <article className="group relative rounded-3xl border border-line bg-surface p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-tomato/40 hover:shadow-paw">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-[1.05rem] font-semibold leading-snug text-fg transition-colors group-hover:text-tomato">
                      {/* The pseudo-element stretches the hit area to the whole
                          card while keeping one real link for the accessibility
                          tree, rather than wrapping the card in an <a> that
                          then contains the score badge. */}
                      <button
                        type="button"
                        onClick={() => onOpen(review)}
                        className="block w-full cursor-pointer text-left focus:outline-none after:absolute after:inset-0 after:rounded-3xl focus-visible:after:ring-2 focus-visible:after:ring-tomato/50"
                      >
                        <span className="line-clamp-2">{review.restaurant_name}</span>
                      </button>
                    </h3>
                    <p
                      className="mt-1 text-[0.8rem] text-muted"
                      title={formatVisitedDate(review.visited_at)}
                    >
                      Visited {formatRelativeDate(review.visited_at)}
                    </p>
                  </div>
                  <ScoreBadge score={review.overall} />
                </div>

                {review.comment && <QuoteBlock comment={review.comment} className="mt-4" />}
              </article>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
