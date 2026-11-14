"use client";

import { useEffect, useRef } from "react";

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
  // Only our key: Next's patched pushState/replaceState adds its own (`__NA`,
  // the tree) and syncs its router to the new URL. Passing Next's keys back in
  // would skip that sync.
  const depth = historyDepth();
  if (mode === "push") window.history.pushState({ [DEPTH_KEY]: depth + 1 }, "", url);
  else window.history.replaceState({ [DEPTH_KEY]: depth }, "", url);
}

const DEPTH_KEY = "samDepth";

/**
 * How many entries this page has pushed on top of the one it was entered on.
 *
 * Kept in `history.state`, on the entry itself, rather than counted in a ref:
 * the browser keeps an entry's state across a reload and hands it back on
 * back/forward, and Next.js preserves it on both (create-initial-router-state
 * and the restore reducer set `preserveCustomHistoryState`). A counter in
 * memory reset to 0 on reload — so /dine took a reloaded restaurant for a
 * deep link and stacked a second list underneath — and counted a *forward*
 * as a back. An entry Next pushes when you arrive from another page has no
 * key, so every page starts at 0.
 */
export function historyDepth(): number {
  const state: unknown = window.history.state;
  const depth = state && typeof state === "object" ? (state as Record<string, unknown>)[DEPTH_KEY] : undefined;
  return typeof depth === "number" ? depth : 0;
}

/**
 * Whether the in-app Back can be `history.back()`.
 *
 * It should be, so the button and the device gesture agree — otherwise
 * pressing in-app Back *pushes* another entry and the gesture then walks
 * forward through views the user already dismissed. But on an entry the page
 * was opened on (a deep link), `history.back()` would leave the app, so the
 * page falls back to changing state instead.
 */
export function canGoBack(): boolean {
  return historyDepth() > 0;
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

const TAB_HOME_EVENT = "sam:tab-home";

/** Tell the page under the tab bar that its own tab was tapped again. See `useTabHome`. */
export function announceTabHome(): void {
  window.dispatchEvent(new Event(TAB_HOME_EVENT));
}

/**
 * Tapping the tab you are already on goes to that tab's main screen.
 *
 * The tab is a link to the page's bare path, but the page is already mounted
 * and reads its view from the query string only on load and on popstate — so
 * the link changed the address bar and nothing else. The shell announces the
 * tap instead of navigating, and the page goes home: back through the entries
 * it pushed when there are any (so the back gesture afterwards leaves the tab
 * instead of reopening what you just left), or `showRoot` when it was opened
 * on a deeper view and has nothing to pop.
 */
export function useTabHome(showRoot: () => void): void {
  const handler = useRef(showRoot);
  handler.current = showRoot;

  useEffect(() => {
    const listener = () => {
      const depth = historyDepth();
      if (depth > 0) window.history.go(-depth);
      else handler.current();
    };
    window.addEventListener(TAB_HOME_EVENT, listener);
    return () => window.removeEventListener(TAB_HOME_EVENT, listener);
  }, []);
}
