import { Quote } from "lucide-react";

/**
 * Price as €…€€€€ with the unused tiers dimmed.
 *
 * The full four glyphs always render so price reads as a position on a scale
 * rather than a count — €€ and €€€ are the same width and instantly comparable
 * down a column of cards.
 */
export function PriceLevel({ level, className = "" }: { level: number; className?: string }) {
  return (
    <span
      className={`font-semibold tracking-tight tabular-nums ${className}`}
      aria-label={`Price level ${level} of 4`}
    >
      {[1, 2, 3, 4].map((n) => (
        <span key={n} className={n <= level ? "text-fg" : "text-muted/35"} aria-hidden>
          €
        </span>
      ))}
    </span>
  );
}

/**
 * The overall score, set in the serif so it reads as a verdict rather than a
 * data point. `tabular-nums` keeps the decimal aligned card to card.
 *
 * Unreviewed restaurants get an em dash instead of a 0 — no score is a
 * different thing from a bad score, and the scrapbook shouldn't imply otherwise.
 */
export function ScoreBadge({
  score,
  size = "md",
}: {
  score: number | null;
  size?: "md" | "lg";
}) {
  const scored = score != null;
  const dimensions = size === "lg" ? "h-14 w-14 text-2xl" : "h-11 w-11 text-lg";

  return (
    <span
      className={`grid shrink-0 place-items-center rounded-2xl font-serif font-semibold tabular-nums ${dimensions} ${
        scored
          // Tinted plate + hairline ring: at 12% alpha on white the plate was
          // invisible and the score read as loose text rather than a badge.
          ? "bg-tomato/10 text-tomato-700 ring-1 ring-inset ring-tomato/20 dark:bg-tomato/20 dark:text-tomato dark:ring-tomato/25"
          : "bg-surface-2 text-muted/70 ring-1 ring-inset ring-line"
      }`}
      aria-label={scored ? `Rated ${score!.toFixed(1)} out of 10` : "Not yet rated"}
    >
      {scored ? score!.toFixed(1) : "—"}
    </span>
  );
}

/**
 * Which parts of a quote's attribution are worth printing, given what the card's
 * footer already says.
 *
 * Without this the common case reads "Nel · 4 days ago" in the quote and
 * "Nel  4 days ago" again immediately below it. So:
 *  - the author only earns a line when more than one person has reviewed the
 *    place, i.e. when "who said this" is genuinely ambiguous;
 *  - the date only earns one when the quote is older than the latest visit —
 *    the case where the newest review had no comment, which is common and
 *    actively misleading if the card implies otherwise.
 */
export function quoteAttribution({
  reviewerNames,
  lastCommentBy,
  lastCommentAt,
  lastVisitedAt,
}: {
  reviewerNames: string[];
  lastCommentBy: string | null;
  lastCommentAt: string | null;
  lastVisitedAt: string | null;
}): { by: string | null; showDate: boolean } {
  return {
    by: reviewerNames.length > 1 ? lastCommentBy : null,
    showDate: Boolean(lastCommentAt && lastCommentAt !== lastVisitedAt),
  };
}

/**
 * A review comment, quoted.
 *
 * This is the emotional centre of a card: the only thing on it written by a
 * person rather than recorded about a venue. Hence the serif italic, the
 * reading-text colour (not muted — muted is for chrome, and this is content),
 * and the oversized quote glyph anchoring it.
 *
 * `lines` clamps rather than truncating mid-character, and the attribution
 * carries its own date because the newest comment is often not from the newest
 * visit (see ReviewAggregate on the backend).
 */
export function QuoteBlock({
  comment,
  by,
  when,
  lines = 2,
  className = "",
}: {
  comment: string;
  by?: string | null;
  when?: string | null;
  lines?: 2 | 3;
  className?: string;
}) {
  return (
    <figure className={`relative ${className}`}>
      <Quote
        className="absolute -left-0.5 -top-0.5 h-4 w-4 shrink-0 text-tomato/30"
        aria-hidden
        strokeWidth={2.5}
      />
      <blockquote
        className={`pl-5 font-serif text-[0.95rem] italic leading-snug text-fg/85 ${
          lines === 2 ? "line-clamp-2" : "line-clamp-3"
        }`}
      >
        {comment}
      </blockquote>
      {(by || when) && (
        <figcaption className="mt-1 pl-5 text-xs text-muted">
          {by}
          {by && when && " · "}
          {when}
        </figcaption>
      )}
    </figure>
  );
}
