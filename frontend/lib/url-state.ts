"use client";

import { useEffect, useMemo, useRef } from "react";

/**
 * Page state in the URL, for a statically exported app.
 *
 * `next.config.ts` sets `output: 'export'`, so dynamic path segments like
 * `/recipes/[id]` would need every id at build time — impossible. Query params
 * are the shape that works today (routing-and-latency-plan.md §3 option A).
 *
 * This uses the History API directly rather than `useSearchParams`, for two
 * reasons: `useSearchParams` forces a Suspense boundary under static export,
 * and `/dine` already reads `window.location.search` this way, so one mechanism
 * beats two.
 *
 * None of this is about speed — §3 is explicit that URLs buy linkability,
 * refresh survival and a working device back gesture, and nothing else. The
 * back gesture is the real prize: in standalone PWA mode there is no browser
 * chrome, so before this the system back gesture left the app entirely.
 */

/** The live query string. Safe to call only on the client. */
export function currentParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

/**
 * Point the address bar at `query`.
 *
 * `push` adds a history entry (so back returns here); `replace` rewrites the
 * current one. Views push — that is what makes back work. Filters replace, so
 * that tweaking a filter five times doesn't cost five back presses.
 */
export function writeUrl(query: string, mode: "push" | "replace"): void {
  const url = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  if (`${window.location.pathname}${window.location.search}` === url) return; // no-op, don't stack duplicates
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

/** Run `onNavigate` when the user goes back or forward. */
export function useBrowserNavigation(onNavigate: (params: URLSearchParams) => void): void {
  const handler = useRef(onNavigate);
  handler.current = onNavigate;

  useEffect(() => {
    const listener = () => handler.current(currentParams());
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);
}

/**
 * Tracks whether this page has pushed any history of its own.
 *
 * The in-app Back button should be `history.back()` so it and the device
 * gesture agree — otherwise pressing in-app Back *pushes* another entry and the
 * device gesture then walks forward through views the user already dismissed.
 * But `history.back()` on a deep link would leave the app, so a page opened
 * straight into a detail view falls back to changing state instead.
 */
export function useHistoryDepth() {
  const depth = useRef(0);
  // One object for the page's lifetime, so effects can list it as a dependency.
  return useMemo(
    () => ({
      recordPush: () => {
        depth.current += 1;
      },
      recordPop: () => {
        depth.current = Math.max(0, depth.current - 1);
      },
      canGoBack: () => depth.current > 0,
    }),
    [],
  );
}
