/** Shared bits for the MapLibre maps.
 *
 * Tiles come from OpenFreeMap (vector, free, no API key) so the Geoapify key
 * never reaches the browser — Geoapify remains the *places* provider only.
 * Positron is a quiet greyscale basemap: the tomato markers carry the brand.
 */
import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";

export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Universal directions deep-link — opens the native maps app on mobile. */
export function directionsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
}

const STAR_SVG =
  '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M12 2l2.94 6.58 7.06.66-5.36 4.73 1.58 6.99L12 17.3l-6.22 3.66 1.58-6.99L2 9.24l7.06-.66z"/></svg>';

export const PAW_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="10" r="2.3"/><circle cx="18.5" cy="10" r="2.3"/><circle cx="9" cy="6" r="2.4"/><circle cx="15" cy="6" r="2.4"/><path d="M12 11.2c-3.3 0-6.2 2.7-6.2 5.5 0 1.8 1.4 2.8 3 2.8 1.2 0 2.1-.6 3.2-.6s2 .6 3.2.6c1.6 0 3-1 3-2.8 0-2.8-2.9-5.5-6.2-5.5z"/></svg>';

/** Inner content of a score pin: ★ 8.7 when rated, a paw when unreviewed. */
export function pinInnerHtml(averageOverall: number | null): string {
  return averageOverall != null
    ? `${STAR_SVG}<span>${averageOverall.toFixed(1)}</span>`
    : PAW_SVG;
}

/**
 * How long a click waits to see whether it is half of a double-click. Long
 * enough for a normal double-tap, short enough that a single tap still feels
 * immediate.
 */
export const DOUBLE_CLICK_MS = 250;

/**
 * A click that is not part of a double-click — shown at once, committed once
 * it is clearly alone.
 *
 * MapLibre fires `click`, `click`, `dblclick` for a double-click, so a plain
 * `click` handler also runs on the zoom gesture: on the pin maps, zooming in
 * dropped the pin where you zoomed. Waiting out the double-click fixes that
 * but makes a tap feel dead for a quarter of a second, with nothing under your
 * finger. So there are two phases:
 *
 * - `preview.show` runs on every click, immediately — the pin jumps to where
 *   you tapped, so you always see what you are pointing at;
 * - `handler` runs only for a click left alone for `DOUBLE_CLICK_MS` — that is
 *   where the expensive part (reverse geocoding, telling the parent) belongs;
 * - on a double-click, `preview.undo` puts the pin back where it was, and the
 *   gesture is just a zoom.
 */
export function onSingleClick(
  map: MapLibreMap,
  handler: (e: MapMouseEvent) => void,
  preview?: { show: (e: MapMouseEvent) => void; undo: () => void },
): void {
  let pending: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (pending) clearTimeout(pending);
    pending = null;
  };
  map.on("click", (e) => {
    cancel();
    preview?.show(e);
    pending = setTimeout(() => {
      pending = null;
      handler(e);
    }, DOUBLE_CLICK_MS);
  });
  map.on("dblclick", () => {
    if (!pending) return;
    cancel();
    preview?.undo();
  });
  // A click still waiting when the map is torn down must not fire into it.
  map.on("remove", cancel);
}
