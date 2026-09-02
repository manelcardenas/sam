"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Navigation } from "lucide-react";
import { MAP_STYLE_URL, PAW_SVG, directionsUrl } from "./map-style";

/** A single restaurant pinned on a small embedded map (detail view).
 *
 * Fills its parent — the parent owns the height/border/rounding. Loaded with
 * next/dynamic (ssr: false), same as RestaurantsMap.
 */
export default function LocationMap({
  name,
  latitude,
  longitude,
}: {
  name: string;
  latitude: number;
  longitude: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: [longitude, latitude],
      zoom: 15,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => setReady(true));

    const pin = document.createElement("div");
    pin.className = "paw-pin";
    pin.innerHTML = PAW_SVG;
    pin.setAttribute("role", "img");
    pin.setAttribute("aria-label", `${name} is here`);
    const wrap = document.createElement("div");
    wrap.className = "paw-pin-wrap";
    wrap.appendChild(pin);
    new maplibregl.Marker({ element: wrap, anchor: "bottom" })
      .setLngLat([longitude, latitude])
      .addTo(map);

    return () => {
      map.remove();
    };
  }, [name, latitude, longitude]);

  return (
    <div className="map-shell relative h-full w-full bg-surface-2">
      {/* h-full, not absolute inset-0: maplibre-gl.css forces position:relative
          on this div (.maplibregl-map), which would collapse an inset-sized box
          to zero height. */}
      <div ref={containerRef} className="h-full w-full" />

      <div
        aria-hidden={ready}
        className={`pointer-events-none absolute inset-0 z-10 bg-surface-2 bg-paws transition-opacity duration-500 ${ready ? "opacity-0" : "opacity-100"}`}
      />

      <a
        href={directionsUrl(latitude, longitude)}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-fg shadow-paw transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
      >
        <Navigation className="h-3.5 w-3.5" />
        Directions
      </a>
    </div>
  );
}
