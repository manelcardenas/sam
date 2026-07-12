import { MapPin, Star } from "lucide-react";
import type { RestaurantDetail } from "@/lib/api-client";

/** Price as €…€€€€ with the unused tier dimmed. */
function Price({ level }: { level: number }) {
  return (
    <span className="font-semibold tracking-tight" aria-label={`Price level ${level} of 4`}>
      {[1, 2, 3, 4].map((n) => (
        <span key={n} className={n <= level ? "text-fg" : "text-muted/40"}>
          €
        </span>
      ))}
    </span>
  );
}

/** A restaurant in the DINE world, rendered as a clickable list card.
 *
 * Semantics: the card is an <article> with the name as a real <h3>, and the
 * click target is a button inside the heading stretched over the whole card
 * (after:inset-0) — headings stay navigable for screen readers, unlike
 * wrapping everything in a <button> (which only permits phrasing content).
 *
 * Responsiveness: the card renders as a grid item, whose min-width defaults
 * to auto — every truncating flex child needs min-w-0 or its nowrap text
 * forces the card (and the page) wider than the viewport on phones.
 */
export function RestaurantCard({
  restaurant: r,
  onClick,
}: {
  restaurant: RestaurantDetail;
  onClick: () => void;
}) {
  return (
    <article className="group relative min-w-0 rounded-3xl border border-line bg-surface p-5 transition-all hover:-translate-y-0.5 hover:border-tomato/40 hover:shadow-paw">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <h3 className="min-w-0 flex-1 font-display text-lg font-semibold text-fg transition-colors group-hover:text-tomato">
          <button
            type="button"
            onClick={onClick}
            className="block w-full cursor-pointer truncate text-left focus:outline-none after:absolute after:inset-0 after:rounded-3xl focus-visible:after:ring-2 focus-visible:after:ring-tomato/50"
          >
            {r.name}
          </button>
        </h3>
        {r.price_level && (
          <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-sm">
            <Price level={r.price_level} />
          </span>
        )}
      </div>

      {(r.cuisines.length > 0 || r.address) && (
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted">
          {r.cuisines.length > 0 && <span className="min-w-0 truncate">{r.cuisines.join(", ")}</span>}
          {r.cuisines.length > 0 && r.address && <span aria-hidden>·</span>}
          {r.address && (
            <span className="flex min-w-0 items-center gap-1">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">{r.address}</span>
            </span>
          )}
        </p>
      )}

      <div className="mt-3 flex items-center gap-1.5 border-t border-line pt-3 text-sm">
        {r.average_overall != null ? (
          <>
            <Star className="h-4 w-4 shrink-0 fill-current text-amber" />
            <span className="font-display font-semibold text-fg">{r.average_overall.toFixed(1)}</span>
            <span className="min-w-0 truncate text-muted">
              · {r.review_count} {r.review_count === 1 ? "review" : "reviews"}
            </span>
          </>
        ) : (
          <span className="text-muted">No reviews yet — be the first!</span>
        )}
      </div>
    </article>
  );
}
