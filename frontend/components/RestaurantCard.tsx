import { MapPin } from "lucide-react";
import type { Restaurant } from "@/lib/api-client";

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

/** A restaurant in the DINE world, rendered as a clickable list card. */
export function RestaurantCard({
  restaurant: r,
  onClick,
}: {
  restaurant: Restaurant;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full cursor-pointer rounded-3xl border border-line bg-surface p-5 text-left transition-all hover:-translate-y-0.5 hover:border-tomato/40 hover:shadow-paw focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg font-semibold text-fg transition-colors group-hover:text-tomato">
            {r.name}
          </h3>
          {(r.cuisines.length > 0 || r.address) && (
            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted">
              {r.cuisines.length > 0 && <span className="truncate">{r.cuisines.join(", ")}</span>}
              {r.cuisines.length > 0 && r.address && <span aria-hidden>·</span>}
              {r.address && (
                <span className="flex min-w-0 items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{r.address}</span>
                </span>
              )}
            </p>
          )}
        </div>
        {r.price_level && (
          <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-sm">
            <Price level={r.price_level} />
          </span>
        )}
      </div>
    </button>
  );
}
