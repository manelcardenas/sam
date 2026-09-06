"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Star, X } from "lucide-react";
import type { RestaurantDetail } from "@/lib/api-client";
import { MAP_STYLE_URL, PAW_SVG, pinInnerHtml, prefersReducedMotion } from "./map-style";

/** Tap-to-drop, drag-to-adjust pin picker — for restaurants the provider
 * doesn't know. Reports every move via onChange; the parent owns confirm.
 *
 * Restaurants already on SAM (with coordinates) show as neutral pins:
 * spotting one where you were about to drop yours is the map-shaped version
 * of the "Already on SAM?" name dedup — tapping it offers to open it instead.
 *
 * Loaded with next/dynamic (ssr: false), same as the other maps.
 */
export default function PinPickerMap({
  initial,
  anchor,
  onChange,
  existing = [],
  onPickExisting,
}: {
  /** Existing pin to start from (edit mode); rendered as a draggable marker. */
  initial: { lat: number; lon: number } | null;
  /** Where to center when there's no pin yet — picked area or user location. */
  anchor: { lat: number; lon: number } | null;
  onChange: (coords: { lat: number; lon: number }) => void;
  /** Restaurants already on SAM, shown as neutral markers (create-mode dedup). */
  existing?: RestaurantDetail[];
  onPickExisting?: (restaurant: RestaurantDetail) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const existingMarkersRef = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [selectedExisting, setSelectedExisting] = useState<RestaurantDetail | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Captured once: the map must not tear down and re-center on parent re-renders.
  const startRef = useRef({ initial, anchor });

  useEffect(() => {
    if (!containerRef.current) return;
    const { initial: startPin, anchor: startAnchor } = startRef.current;
    const start = startPin ?? startAnchor;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: start ? [start.lon, start.lat] : [-3.7, 40.4],
      zoom: startPin ? 16 : startAnchor ? 13 : 4,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => setReady(true));

    const pin = document.createElement("div");
    pin.className = "paw-pin";
    pin.innerHTML = PAW_SVG;
    pin.setAttribute("role", "img");
    pin.setAttribute("aria-label", "Restaurant pin — drag to adjust");
    const wrap = document.createElement("div");
    wrap.className = "paw-pin-wrap";
    wrap.appendChild(pin);
    const marker = new maplibregl.Marker({ element: wrap, anchor: "bottom", draggable: true });

    let placed = false;
    if (startPin) {
      marker.setLngLat([startPin.lon, startPin.lat]).addTo(map);
      placed = true;
    }

    const report = () => {
      const { lat, lng } = marker.getLngLat();
      onChangeRef.current({ lat, lon: lng });
    };
    marker.on("dragend", report);
    map.on("click", (e) => {
      setSelectedExisting(null);
      marker.setLngLat(e.lngLat);
      if (!placed) {
        marker.addTo(map);
        placed = true;
      }
      report();
    });

    mapRef.current = map;
    const existingMarkers = existingMarkersRef.current;
    return () => {
      map.remove();
      mapRef.current = null;
      existingMarkers.length = 0;
    };
  }, []);

  // Neutral markers for restaurants already on SAM — may arrive after mount.
  const existingKey = existing.map((r) => `${r.id}:${r.latitude}:${r.longitude}`).join("|");
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    existingMarkersRef.current.forEach((m) => m.remove());
    existingMarkersRef.current = [];

    for (const r of existing) {
      if (r.latitude == null || r.longitude == null) continue;
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "paw-pin";
      pin.dataset.variant = "existing";
      pin.innerHTML = pinInnerHtml(r.average_overall);
      pin.setAttribute("aria-label", `${r.name} — already on SAM`);
      pin.addEventListener("click", (e) => {
        e.stopPropagation(); // don't also drop the new pin here
        setSelectedExisting(r);
        map.easeTo({
          center: [r.longitude!, r.latitude!],
          duration: prefersReducedMotion() ? 0 : 400,
        });
      });
      const wrap = document.createElement("div");
      wrap.className = "paw-pin-wrap";
      wrap.appendChild(pin);
      const marker = new maplibregl.Marker({ element: wrap, anchor: "bottom" })
        .setLngLat([r.longitude, r.latitude])
        .addTo(map);
      existingMarkersRef.current.push(marker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingKey, ready]);

  return (
    <div className="map-shell relative h-64 w-full overflow-hidden rounded-2xl border border-line bg-surface-2">
      <div ref={containerRef} className="h-full w-full" />
      {/* top-left, clear of the zoom controls (top-right) and attribution (bottom-right) */}
      <p className="pointer-events-none absolute left-2 top-2 z-10 rounded-full bg-surface/90 px-3 py-1 text-xs font-medium text-muted shadow-paw">
        Tap to drop the pin · drag to adjust
      </p>

      {/* "Is this the one you meant?" — the map-shaped dedup card */}
      {selectedExisting && (
        <div key={selectedExisting.id} className="absolute inset-x-2 bottom-2 z-20 animate-fetch-in">
          <div className="relative rounded-2xl border border-line bg-surface p-3 shadow-paw">
            <button
              type="button"
              onClick={() => setSelectedExisting(null)}
              aria-label="Close"
              className="absolute right-1.5 top-1.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber">
              Already on SAM
            </p>
            <h4 className="min-w-0 truncate pr-7 font-display text-sm font-semibold text-fg">
              {selectedExisting.name}
            </h4>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1 text-xs text-muted">
                {selectedExisting.average_overall != null ? (
                  <>
                    <Star className="h-3.5 w-3.5 shrink-0 fill-current text-amber" />
                    <span className="font-semibold text-fg">{selectedExisting.average_overall.toFixed(1)}</span>
                    <span className="min-w-0 truncate">
                      · {selectedExisting.review_count} {selectedExisting.review_count === 1 ? "review" : "reviews"}
                    </span>
                  </>
                ) : (
                  <span className="min-w-0 truncate">{selectedExisting.address ?? "No reviews yet"}</span>
                )}
              </span>
              {onPickExisting && (
                <button
                  type="button"
                  onClick={() => onPickExisting(selectedExisting)}
                  className="shrink-0 cursor-pointer rounded-full bg-tomato px-3.5 py-1.5 font-display text-xs font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                >
                  This is it — open it
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
