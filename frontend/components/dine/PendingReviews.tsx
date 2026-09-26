"use client";

import { useState } from "react";
import { NotebookPen } from "lucide-react";
import type { RestaurantDetail } from "@/lib/api-client";
import { cuisineAccent } from "@/lib/cuisines";
import { formatRelativeDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/** Past this many, the rest fold behind "show all" — the block must not bury the list. */
const SHOWN = 3;

/**
 * "You owe these a review" — the places you added and never reviewed, at the
 * top of /dine.
 *
 * **Why a block and not only a badge on the card.** A marked card is found only
 * by someone already scrolling the archive, and the archive's own sorts push an
 * unscored place to the bottom. The block is the one place the gap is stated,
 * above everything, with the button that closes it on each row — one tap to the
 * review form, not a tap to the detail page and a second hunt for the button.
 *
 * **Why the copy is about memory, not duty.** "Pending" and "incomplete" read as
 * a chore. What is actually missing is what you thought of the meal, and that is
 * the thing people want to write down — so the heading says how many, and the
 * body says what is lost and how little it costs.
 *
 * It cannot be dismissed. Reviewing is what clears it, and one that could be
 * waved away would be waved away on the first visit and never seen again.
 */
export function PendingReviews({
  restaurants,
  onReview,
}: {
  /** From `awaitingMyReview` — already yours, unreviewed and newest first. */
  restaurants: RestaurantDetail[];
  onReview: (restaurant: RestaurantDetail) => void;
}) {
  const { locale, t, tp } = useI18n();
  const [expanded, setExpanded] = useState(false);
  if (restaurants.length === 0) return null;

  const shown = expanded ? restaurants : restaurants.slice(0, SHOWN);
  const hidden = restaurants.length - shown.length;

  return (
    <section
      aria-labelledby="pending-reviews-heading"
      className="mb-7 rounded-4xl border border-amber/40 bg-amber/10 p-5 will-fetch animate-fetch-in"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber text-ink" aria-hidden>
          <NotebookPen className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 id="pending-reviews-heading" className="font-display text-lg font-bold leading-snug text-fg">
            {tp("pending-reviews.title", restaurants.length)}
          </h2>
          <p className="mt-0.5 text-sm text-muted">{t("pending-reviews.body")}</p>
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {shown.map((r) => (
          <li
            key={r.id}
            className="flex min-w-0 items-center gap-3 rounded-3xl border border-line bg-surface py-2.5 pl-4 pr-2.5"
          >
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: cuisineAccent(r.cuisines[0] ?? "") }}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-fg">{r.name}</p>
              <p className="truncate text-xs text-muted">
                {t("pending-reviews.added", { when: formatRelativeDate(r.created_at.slice(0, 10), locale) })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onReview(r)}
              aria-label={t("pending-reviews.review-label", { name: r.name })}
              className="flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-tomato px-4 font-display text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
            >
              {t("pending-reviews.review")}
            </button>
          </li>
        ))}
      </ul>

      {(hidden > 0 || expanded) && restaurants.length > SHOWN && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="mt-3 cursor-pointer rounded-full px-2 py-1 text-sm font-bold text-amber-700 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 dark:text-amber"
        >
          {expanded ? t("pending-reviews.show-fewer") : tp("pending-reviews.show-more", hidden)}
        </button>
      )}
    </section>
  );
}
