"use client";

import { useEffect, useRef } from "react";

/**
 * Keeping a shared shopping list roughly in step between two phones.
 *
 * **Why polling and not something real-time.** This app is a Lambda behind an
 * API Gateway HTTP API, and the budget is "must stay free". WebSockets need a
 * *different* API type, `$connect`/`$disconnect` routes and a DynamoDB table of
 * connection ids, billed per connection-minute. SSE needs Lambda response
 * streaming, which works through Function URLs and **not** through API Gateway,
 * bills for the whole time the connection is held open, and caps at the 15
 * minute function limit. gRPC is not served by HTTP API at all, and browsers
 * would need a grpc-web proxy in front of it. Polling needs none of that: it is
 * the same authenticated GET the page already makes, and at the rate below a
 * household spends on the order of a thousand extra requests a month against a
 * free tier of a million.
 *
 * **So the whole design is about not polling when it would be wasted**, and all
 * four gates are the caller's to pass in except the last two:
 *
 * - only on the shopping list, which is the one screen two people look at
 *   simultaneously — the calendar gets filled in by one person at a time;
 * - only when somebody else is actually in the kitchen;
 * - only while the tab is visible, because a backgrounded phone has no reader;
 * - only while somebody is still there — a page left open on a counter stops
 *   polling after a few minutes and starts again the moment it is touched.
 *
 * Refetching on focus is the other half, and the more valuable one: coming back
 * to the tab is exactly when the list is most likely to be stale, and it costs
 * one request at the moment somebody is looking.
 */

/** Long enough that it is cheap, short enough that the other person's tick lands before you re-read the shelf. */
const POLL_MS = 20_000;
/** A page nobody has touched for this long is on a counter, not in a hand. */
const IDLE_AFTER_MS = 5 * 60_000;

export function useLivePlan({ enabled, onRefresh }: { enabled: boolean; onRefresh: () => void }): void {
  // Held in a ref so a new `onRefresh` identity each render — which is what a
  // closure over component state gives you — does not restart the interval and
  // reset the countdown on every keystroke.
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  const lastSeen = useRef(Date.now());

  useEffect(() => {
    if (!enabled) return;

    const touched = () => {
      lastSeen.current = Date.now();
    };
    const refetchIfVisible = () => {
      if (document.visibilityState !== "visible") return;
      touched();
      refresh.current();
    };

    const timer = window.setInterval(() => {
      // Checked here rather than by tearing the interval down and putting it
      // back: visibility and idleness both flip often, and a subscription that
      // re-registers on each flip is more moving parts than one cheap test.
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastSeen.current > IDLE_AFTER_MS) return;
      refresh.current();
    }, POLL_MS);

    window.addEventListener("focus", refetchIfVisible);
    document.addEventListener("visibilitychange", refetchIfVisible);
    // Passive: these only read a clock, and a listener that can't preventDefault
    // keeps scrolling off the main thread.
    document.addEventListener("pointerdown", touched, { passive: true });
    document.addEventListener("keydown", touched, { passive: true });

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refetchIfVisible);
      document.removeEventListener("visibilitychange", refetchIfVisible);
      document.removeEventListener("pointerdown", touched);
      document.removeEventListener("keydown", touched);
    };
  }, [enabled]);
}
