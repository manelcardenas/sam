import { MapPin, Users } from "lucide-react";
import type { RestaurantDetail } from "@/lib/api-client";
import { formatRelativeDate, formatReviewers } from "@/lib/format";
import { PriceLevel, QuoteBlock, ScoreBadge, quoteAttribution } from "@/components/dine/atoms";

/**
 * A restaurant in the DINE world, rendered as a clickable card in the archive grid.
 *
 * What it shows and why (docs/adr/0005): the list is a record of meals, not an
 * inventory of venues, so the card leads with the human trace of the visit — the
 * most recent review comment, who went, and when — and treats the venue's facts
 * (cuisine, address, price) as supporting metadata. A card with no reviews falls
 * back to an invitation rather than rendering an empty quote well.
 *
 * Semantics: an <article> with the name as a real <h3>, and the click target a
 * button inside the heading stretched over the whole card (after:inset-0), so
 * headings stay navigable for screen readers — unlike wrapping everything in a
 * <button>, which only permits phrasing content.
 *
 * Responsiveness: the card is a grid item, whose min-width defaults to auto —
 * every truncating flex child needs min-w-0 or its nowrap text forces the card
 * (and the page) wider than the viewport on phones. Real data includes long CJK
 * names, so this matters more than it looks.
 */
export function RestaurantCard({
  restaurant: r,
  onClick,
}: {
  restaurant: RestaurantDetail;
  onClick: () => void;
}) {
  const reviewers = formatReviewers(r.reviewer_names);
  // Suppress attribution the footer already carries — see quoteAttribution.
  const attribution = quoteAttribution({
    reviewerNames: r.reviewer_names,
    lastCommentBy: r.last_comment_by,
    lastCommentAt: r.last_comment_at,
    lastVisitedAt: r.last_visited_at,
  });

  return (
    <article className="group relative flex min-w-0 flex-col rounded-3xl border border-line bg-surface p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-tomato/40 hover:shadow-paw">
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="min-w-0 font-display text-[1.05rem] font-semibold leading-snug text-fg transition-colors group-hover:text-tomato">
            <button
              type="button"
              onClick={onClick}
              className="block w-full cursor-pointer text-left focus:outline-none after:absolute after:inset-0 after:rounded-3xl focus-visible:after:ring-2 focus-visible:after:ring-tomato/50"
            >
              {/* Two lines rather than one: CJK names run long and a single
                  truncated line loses the Latin half entirely. */}
              <span className="line-clamp-2 [overflow-wrap:anywhere]">{r.name}</span>
            </button>
          </h3>

          {(r.cuisines.length > 0 || r.price_level) && (
            <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[0.8rem]">
              {r.cuisines.length > 0 && (
                <span className="min-w-0 truncate font-medium uppercase tracking-wide text-muted">
                  {r.cuisines.join(" · ")}
                </span>
              )}
              {r.price_level && <PriceLevel level={r.price_level} className="text-[0.8rem]" />}
            </p>
          )}
        </div>

        <ScoreBadge score={r.average_overall} />
      </div>

      {/* The memory. Grows to fill, so footers align across a row of cards. */}
      <div className="mt-4 flex-1">
        {r.last_comment ? (
          <QuoteBlock
            comment={r.last_comment}
            by={attribution.by}
            when={attribution.showDate && r.last_comment_at ? formatRelativeDate(r.last_comment_at) : null}
          />
        ) : r.review_count > 0 ? (
          <p className="text-sm text-muted">
            {r.review_count === 1 ? "One visit" : `${r.review_count} visits`}, no notes written.
          </p>
        ) : (
          <p className="text-sm text-muted">Not reviewed yet — be the first.</p>
        )}
      </div>

      <div className="mt-4 flex min-w-0 items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-xs text-muted">
        {reviewers && (
          <span className="flex min-w-0 items-center gap-1.5">
            <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{reviewers}</span>
          </span>
        )}
        {r.last_visited_at && (
          <span className="shrink-0 whitespace-nowrap">{formatRelativeDate(r.last_visited_at)}</span>
        )}
        {!reviewers && !r.last_visited_at && r.address && (
          <span className="flex min-w-0 items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{r.address}</span>
          </span>
        )}
      </div>
    </article>
  );
}
