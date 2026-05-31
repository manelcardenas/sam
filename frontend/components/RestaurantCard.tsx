import { MapPin, Star } from "lucide-react";
import type { Restaurant } from "@/lib/restaurants";

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

/**
 * A restaurant in the DINE world. `preview` renders a non-interactive teaser
 * (used on /dine before the API exists) — dimmed, no hover, not focusable.
 */
export function RestaurantCard({
  restaurant: r,
  preview = false,
}: {
  restaurant: Restaurant;
  preview?: boolean;
}) {
  return (
    <article
      className={`group rounded-3xl border border-line bg-surface p-5 transition-all ${
        preview
          ? "pointer-events-none select-none opacity-70"
          : "hover:-translate-y-0.5 hover:border-tomato/40 hover:shadow-paw"
      }`}
      aria-hidden={preview || undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg font-semibold text-fg">
            {r.name}
          </h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
            <span>{r.cuisine}</span>
            <span aria-hidden>·</span>
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{r.area}</span>
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber/15 px-2.5 py-1 text-sm font-semibold text-amber-700 dark:text-amber">
          <Star className="h-3.5 w-3.5 fill-current" />
          {r.rating.toFixed(1)}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-sm">
        <Price level={r.priceLevel} />
        {r.recommendedBy && (
          <span className="text-muted">
            by <span className="font-semibold text-tomato">{r.recommendedBy}</span>
          </span>
        )}
      </div>
    </article>
  );
}
