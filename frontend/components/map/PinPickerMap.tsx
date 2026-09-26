"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MAP_STYLE_URL, PAW_SVG, onSingleClick } from "./map-style";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/** Tap-to-drop, drag-to-adjust pin picker for moving an existing restaurant's
 * pin. Reports every move via onChange; the parent owns confirm.
 *
 * Adding a restaurant has its own map (`AddPlaceMap`), which also shows the
 * provider's candidates; this one only has to move a single pin.
 *
 * Loaded with next/dynamic (ssr: false), same as the other maps.
 */
export default function PinPickerMap({
  initial,
  onChange,
}: {
  /** The restaurant's current pin, if it has one; rendered as a draggable marker. */
  initial: { lat: number; lon: number } | null;
  onChange: (coords: { lat: number; lon: number }) => void;
}) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Captured once: the map must not tear down and re-center on parent re-renders.
  const startRef = useRef(initial);

  useEffect(() => {
    if (!containerRef.current) return;
    const startPin = startRef.current;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: startPin ? [startPin.lon, startPin.lat] : [-3.7, 40.4],
      zoom: startPin ? 16 : 4,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    const pin = document.createElement("div");
    pin.className = "paw-pin";
    pin.innerHTML = PAW_SVG;
    pin.setAttribute("role", "img");
    pin.setAttribute("aria-label", t("add-restaurant.dropped-pin"));
    const wrap = document.createElement("div");
    wrap.className = "paw-pin-wrap";
    wrap.appendChild(pin);
    const marker = new maplibregl.Marker({ element: wrap, anchor: "bottom", draggable: true });

    let placed = false;
    // Where the pin last settled: what a double-click puts it back to.
    let committed: maplibregl.LngLat | null = null;
    if (startPin) {
      marker.setLngLat([startPin.lon, startPin.lat]).addTo(map);
      placed = true;
      committed = marker.getLngLat();
    }

    const report = () => {
      committed = marker.getLngLat();
      onChangeRef.current({ lat: committed.lat, lon: committed.lng });
    };
    marker.on("dragend", report);
    // The paw jumps to a tap at once; it only counts once the tap is clearly
    // not half of a double-click, which is the zoom gesture.
    onSingleClick(map, report, {
      show: (e) => {
        marker.setLngLat(e.lngLat);
        if (!placed) {
          marker.addTo(map);
          placed = true;
        }
      },
      undo: () => {
        if (committed) {
          marker.setLngLat(committed);
        } else {
          marker.remove();
          placed = false;
        }
      },
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="map-shell relative h-64 w-full overflow-hidden rounded-2xl border border-line bg-surface-2">
      <div ref={containerRef} className="h-full w-full" />
      {/* top-left, clear of the zoom controls (top-right) and attribution (bottom-right) */}
      <p className="pointer-events-none absolute left-2 top-2 z-10 rounded-full bg-surface/90 px-3 py-1 text-xs font-medium text-muted shadow-paw">
        {t("map.pin-hint")}
      </p>
    </div>
  );
}
