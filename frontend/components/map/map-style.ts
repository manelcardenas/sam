/** Shared bits for the MapLibre maps.
 *
 * Tiles come from OpenFreeMap (vector, free, no API key) so the Geoapify key
 * never reaches the browser — Geoapify remains the *places* provider only.
 * Positron is a quiet greyscale basemap: the tomato markers carry the brand.
 */
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
