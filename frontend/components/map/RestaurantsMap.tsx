"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapPin, Star, X } from "lucide-react";
import type { RestaurantDetail } from "@/lib/api-client";
import { MAP_STYLE_URL, pinInnerHtml, prefersReducedMotion } from "./map-style";

/** The pack's restaurants on one map: score-pill markers, tap → slide-up card.
 *
 * Loaded with next/dynamic (ssr: false) — MapLibre needs the DOM and is heavy,
 * so it must stay out of the initial bundle and out of the static export pass.
 */
export default function RestaurantsMap({
  restaurants,
  onOpenRestaurant,
}: {
  restaurants: RestaurantDetail[];
  onOpenRestaurant: (restaurant: RestaurantDetail) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef(new Map<string, { marker: maplibregl.Marker; pin: HTMLButtonElement }>());
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<RestaurantDetail | null>(null);

  const mapped = useMemo(
    () => restaurants.filter((r) => r.latitude != null && r.longitude != null),
    [restaurants],
  );
  // Rebuild markers only when something a pin shows actually changes.
  const markersKey = mapped
    .map((r) => `${r.id}:${r.latitude}:${r.longitude}:${r.average_overall}`)
    .join("|");

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: [-3.7, 40.4], // fitBounds takes over as soon as markers land
      zoom: 4,
      attributionControl: { compact: true },
      cooperativeGestures: true, // don't hijack page scroll / one-finger pan
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => setReady(true));
    map.on("click", () => setSelected(null)); // marker clicks stopPropagation
    mapRef.current = map;
    const markers = markersRef.current;
    return () => {
      map.remove();
      mapRef.current = null;
      markers.clear();
    };
  }, []);

  // (Re)build the pins whenever the visible set changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    markersRef.current.forEach(({ marker }) => marker.remove());
    markersRef.current.clear();

    for (const r of mapped) {
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "paw-pin";
      pin.innerHTML = pinInnerHtml(r.average_overall);
      pin.setAttribute(
        "aria-label",
        r.average_overall != null
          ? `${r.name}, rated ${r.average_overall.toFixed(1)}`
          : `${r.name}, no reviews yet`,
      );
      pin.addEventListener("click", (e) => {
        e.stopPropagation();
        setSelected(r);
        map.easeTo({
          center: [r.longitude!, r.latitude!],
          duration: prefersReducedMotion() ? 0 : 450,
        });
      });

      // MapLibre positions the marker element via transform — the hover/select
      // scale lives on the inner button so the two never fight.
      const wrap = document.createElement("div");
      wrap.className = "paw-pin-wrap";
      wrap.appendChild(pin);

      const marker = new maplibregl.Marker({ element: wrap, anchor: "bottom" })
        .setLngLat([r.longitude!, r.latitude!])
        .addTo(map);
      markersRef.current.set(r.id, { marker, pin });
    }

    // Drop the selection if its restaurant was filtered out.
    setSelected((cur) => (cur && !mapped.some((r) => r.id === cur.id) ? null : cur));

    if (mapped.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      mapped.forEach((r) => bounds.extend([r.longitude!, r.latitude!]));
      map.fitBounds(bounds, {
        padding: { top: 70, bottom: 96, left: 48, right: 48 },
        maxZoom: 15.5,
        duration: prefersReducedMotion() ? 0 : 700,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markersKey, ready]);

  // Reflect selection on the pins (inverted fg/bg chip + raised z-index).
  useEffect(() => {
    markersRef.current.forEach(({ marker, pin }, id) => {
      const isSelected = selected?.id === id;
      pin.dataset.selected = String(isSelected);
      marker.getElement().style.zIndex = isSelected ? "10" : "";
    });
  }, [selected, markersKey]);

  return (
    <div className="map-shell relative h-[65vh] min-h-[420px] overflow-hidden rounded-4xl border border-line bg-surface-2 shadow-paw">
      {/* h-full, not absolute inset-0: maplibre-gl.css forces position:relative
          on this div (.maplibregl-map), which would collapse an inset-sized box
          to zero height. */}
      <div ref={containerRef} className="h-full w-full" />

      {/* Skeleton that fades away once the basemap is in. */}
      <div
        aria-hidden={ready}
        className={`pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-surface-2 bg-paws transition-opacity duration-500 ${ready ? "opacity-0" : "opacity-100"}`}
      >
        <div className="flex flex-col items-center gap-2 text-muted">
          <MapPin className="h-7 w-7 animate-float" />
          <span className="text-sm">Loading the map…</span>
        </div>
      </div>

      {/* Slide-up card for the tapped restaurant. */}
      {selected && (
        <div key={selected.id} className="absolute inset-x-3 bottom-3 z-20 mx-auto max-w-md animate-fetch-in">
          <div className="rounded-3xl border border-line bg-surface p-4 shadow-paw">
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Close"
              className="absolute right-2.5 top-2.5 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
            >
              <X className="h-4 w-4" />
            </button>

            <h3 className="min-w-0 truncate pr-9 font-display text-lg font-semibold text-fg">
              {selected.name}
            </h3>
            {(selected.cuisines.length > 0 || selected.address) && (
              <p className="mt-0.5 min-w-0 truncate text-sm text-muted">
                {[selected.cuisines.join(", "), selected.address].filter(Boolean).join(" · ")}
              </p>
            )}

            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-1.5 text-sm">
                {selected.average_overall != null ? (
                  <>
                    <Star className="h-4 w-4 shrink-0 fill-current text-amber" />
                    <span className="font-display font-semibold text-fg">
                      {selected.average_overall.toFixed(1)}
                    </span>
                    <span className="min-w-0 truncate text-muted">
                      · {selected.review_count} {selected.review_count === 1 ? "review" : "reviews"}
                    </span>
                  </>
                ) : (
                  <span className="text-muted">No reviews yet</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => onOpenRestaurant(selected)}
                className="shrink-0 cursor-pointer rounded-full bg-tomato px-4 py-2 font-display text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
              >
                View details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
