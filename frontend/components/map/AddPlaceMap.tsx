"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Place } from "@/lib/api-client";
import { MAP_STYLE_URL, PAW_SVG, onSingleClick, prefersReducedMotion } from "./map-style";
import { useI18n } from "@/lib/i18n/LocaleProvider";

type Coords = { lat: number; lon: number };

/**
 * The map you add a restaurant on: it is both the list of candidates and the
 * place you point at.
 *
 * - **Tomato paw pins** are restaurants the provider knows around the searched
 *   spot. Tap one to pick it.
 * - **Tap anywhere else** (or on your own blue dot) and a paw drops there at
 *   once, with a halo that marks it as yours; drag it to adjust. That is how a place the provider does not know
 *   gets a location — no separate "drop a pin" mode, no separate "use my
 *   location" button: the map is the control.
 *
 * Everything is reported up; the parent owns what is selected, where the
 * dropped pin is and where the camera goes (`flyTo`, `fit`), so the search box
 * and the list under the map can drive it too.
 *
 * Loaded with next/dynamic (ssr: false), same as the other maps.
 */
export default function AddPlaceMap({
  start,
  you,
  places,
  selectedId,
  dropped,
  flyTo,
  fit,
  onSelect,
  onDrop,
  onMoveEnd,
}: {
  start: { center: Coords; zoom: number };
  you: Coords | null;
  places: Place[];
  selectedId: string | null;
  dropped: Coords | null;
  /** Move the camera; `seq` makes the same target fly again. */
  flyTo: { center: Coords; zoom: number; seq: number } | null;
  /** Frame `around` and the nearest places; `seq` re-runs it after a new search. */
  fit: { around: Coords; seq: number } | null;
  onSelect: (id: string | null) => void;
  onDrop: (coords: Coords) => void;
  onMoveEnd: (view: { center: Coords; zoom: number }) => void;
}) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pinsRef = useRef(new Map<string, { marker: maplibregl.Marker; pin: HTMLButtonElement }>());
  const youRef = useRef<maplibregl.Marker | null>(null);
  const dropRef = useRef<maplibregl.Marker | null>(null);
  const [ready, setReady] = useState(false);
  // Callbacks through refs: the map is built once and must not be rebuilt
  // because a parent re-rendered with a new closure.
  const handlers = useRef({ onSelect, onDrop, onMoveEnd });
  handlers.current = { onSelect, onDrop, onMoveEnd };
  const startRef = useRef(start);
  // The parent's settled drop, for putting a previewed pin back on a double-click.
  const droppedRef = useRef(dropped);
  droppedRef.current = dropped;

  /** The dropped pin, created on first use: a paw like the rest, with a halo that says "yours". */
  const ensureDropMarker = (map: maplibregl.Map): maplibregl.Marker => {
    if (dropRef.current) return dropRef.current;
    const pin = document.createElement("div");
    pin.className = "paw-pin";
    pin.dataset.variant = "drop";
    pin.innerHTML = PAW_SVG;
    pin.setAttribute("role", "img");
    pin.setAttribute("aria-label", t("add-restaurant.dropped-pin"));
    const wrap = document.createElement("div");
    wrap.className = "paw-pin-wrap";
    wrap.appendChild(pin);
    const marker = new maplibregl.Marker({ element: wrap, anchor: "bottom", draggable: true });
    marker.on("dragend", () => {
      const at = marker.getLngLat();
      handlers.current.onDrop({ lat: at.lat, lon: at.lng });
    });
    // Above the provider's pins, so it is never hidden behind one.
    wrap.style.zIndex = "20";
    dropRef.current = marker.setLngLat(map.getCenter()).addTo(map);
    return marker;
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: [startRef.current.center.lon, startRef.current.center.lat],
      zoom: startRef.current.zoom,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => setReady(true));
    // Pins stop propagation, so a click that reaches the map is empty ground.
    // The paw lands where you tap at once; it counts — and its address is
    // looked up — only once the tap is clearly not half of a double-click.
    onSingleClick(
      map,
      (e) => {
        handlers.current.onSelect(null);
        handlers.current.onDrop({ lat: e.lngLat.lat, lon: e.lngLat.lng });
      },
      {
        show: (e) => ensureDropMarker(map).setLngLat(e.lngLat),
        undo: () => {
          const settled = droppedRef.current;
          if (settled) dropRef.current?.setLngLat([settled.lon, settled.lat]);
          else {
            dropRef.current?.remove();
            dropRef.current = null;
          }
        },
      },
    );
    map.on("moveend", () => {
      const c = map.getCenter();
      handlers.current.onMoveEnd({ center: { lat: c.lat, lon: c.lng }, zoom: map.getZoom() });
    });

    mapRef.current = map;
    const pins = pinsRef.current;
    return () => {
      map.remove();
      mapRef.current = null;
      youRef.current = null;
      dropRef.current = null;
      pins.clear();
    };
    // Built once; everything it calls later is read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // You: the blue dot every maps app has taught people to read as "here".
  // Tapping it drops the pin exactly on you — "I'm in it" in one tap.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!you) {
      youRef.current?.remove();
      youRef.current = null;
      return;
    }
    if (!youRef.current) {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "you-dot";
      dot.setAttribute("aria-label", t("add-restaurant.you-are-here"));
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        const at = youRef.current?.getLngLat();
        if (!at) return;
        handlers.current.onSelect(null);
        handlers.current.onDrop({ lat: at.lat, lon: at.lng });
      });
      youRef.current = new maplibregl.Marker({ element: dot }).setLngLat([you.lon, you.lat]).addTo(map);
    } else {
      youRef.current.setLngLat([you.lon, you.lat]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [you?.lat, you?.lon]);

  // The dropped pin follows the parent's settled position; clearing it removes it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!dropped) {
      dropRef.current?.remove();
      dropRef.current = null;
      return;
    }
    ensureDropMarker(map).setLngLat([dropped.lon, dropped.lat]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropped?.lat, dropped?.lon]);

  const placesKey = places.map((p) => p.external_place_id).join("|");
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    pinsRef.current.forEach(({ marker }) => marker.remove());
    pinsRef.current.clear();
    for (const place of places) {
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "paw-pin";
      pin.innerHTML = PAW_SVG;
      pin.setAttribute("aria-label", place.name);
      pin.addEventListener("click", (e) => {
        e.stopPropagation();
        handlers.current.onSelect(place.external_place_id);
      });
      const wrap = document.createElement("div");
      wrap.className = "paw-pin-wrap";
      wrap.appendChild(pin);
      const marker = new maplibregl.Marker({ element: wrap, anchor: "bottom" })
        .setLngLat([place.longitude, place.latitude])
        .addTo(map);
      pinsRef.current.set(place.external_place_id, { marker, pin });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placesKey, ready]);

  // Frame the searched spot and its nearest handful — not all twenty: the far
  // ones are the least likely answer, and fitting them zooms out past where
  // names are readable.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !fit) return;
    const bounds = new maplibregl.LngLatBounds([fit.around.lon, fit.around.lat], [fit.around.lon, fit.around.lat]);
    places.slice(0, 6).forEach((p) => bounds.extend([p.longitude, p.latitude]));
    map.fitBounds(bounds, {
      padding: { top: 70, bottom: 70, left: 40, right: 40 },
      maxZoom: 17.5,
      duration: prefersReducedMotion() ? 0 : 500,
    });
    // Deliberately not on `places`: a search result added to the list later
    // must not yank the camera away from where `flyTo` just took it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit?.seq, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    map.flyTo({ center: [flyTo.center.lon, flyTo.center.lat], zoom: flyTo.zoom, duration: prefersReducedMotion() ? 0 : 700 });
  }, [flyTo]);

  useEffect(() => {
    pinsRef.current.forEach(({ marker, pin }, id) => {
      const on = id === selectedId;
      pin.dataset.selected = String(on);
      marker.getElement().style.zIndex = on ? "10" : "";
    });
  }, [selectedId, placesKey]);

  return (
    <div className="map-shell relative h-[22rem] w-full overflow-hidden rounded-3xl border border-line bg-surface-2 sm:h-96">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
