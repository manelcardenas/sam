"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Eases a number up to `target` on first mount.
 *
 * Used only on the profile's headline figures, which are the page's one moment
 * of scale — the movement is what makes them read as *your* numbers rather than
 * as table cells. Everywhere else a number appearing at its value is correct.
 *
 * Three things it deliberately gets right:
 *
 *  - **It starts at 0, not at `target`.** Any version that initialises to
 *    `target` paints the final number once and then drops to zero on the first
 *    animation frame, because `useEffect` runs after paint. Starting at 0 means
 *    server and client agree on the first render, so there is no hydration
 *    mismatch either.
 *  - **Only the first mount animates.** A later change to `target` — a
 *    background revalidation handing back 22 reviews instead of 21 — lands
 *    instantly. Re-running the ease would make an almost-unchanged number
 *    travel all the way from zero, which reads as a glitch rather than as an
 *    update.
 *  - **Reduced motion schedules no frame at all.** The global CSS rule in
 *    globals.css cannot help here, because this animates state rather than a
 *    property.
 *
 * Known and accepted: a reduced-motion viewer sees one frame of `0` before the
 * effect commits the real value. Removing it would mean initialising from
 * `matchMedia`, which differs between server and client and so trades 16ms for
 * a hydration mismatch.
 */
export function useCountUp(target: number, duration = 650): number {
  const [value, setValue] = useState(0);
  const hasAnimated = useRef(false);

  useEffect(() => {
    // `matchMedia` is guarded rather than assumed: this module is bundled into
    // a statically exported page, so it must not throw if it is ever evaluated
    // outside a browser.
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (hasAnimated.current || reduced || target === 0 || typeof requestAnimationFrame !== "function") {
      hasAnimated.current = true;
      setValue(target);
      return;
    }
    hasAnimated.current = true;

    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic: fast off the mark, settles rather than stops.
      setValue(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}
