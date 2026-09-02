"use client";

import { useLayoutEffect, useRef } from "react";

/** True when the viewer has asked the OS for reduced motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * FLIP reflow for a list whose members move when it is filtered or re-sorted.
 *
 * Why it exists: when chips narrow 24 cards to 6, cards snapping to new
 * positions gives no sense of what left and what stayed. Animating survivors
 * from their old box to their new one makes the change legible — motion in
 * service of comprehension rather than decoration.
 *
 * How: on every change of `key`, measure each tracked child's box (First),
 * let React paint the new layout (Last), Invert by transforming each element
 * back to where it was, then Play to zero. Transform and opacity only — never
 * layout properties — so this stays on the compositor.
 *
 * Accessibility: globals.css flattens CSS transition durations under
 * prefers-reduced-motion, but that media query CANNOT stop a Web Animations
 * API animation, so this checks the preference itself and skips to the final
 * position. That is the whole reason the check is duplicated here.
 */
export function useFlipGrid<T extends HTMLElement = HTMLDivElement>(key: string) {
  const containerRef = useRef<T | null>(null);
  const previous = useRef<Map<string, DOMRect>>(new Map());
  // Skip the very first pass: there is no previous layout to animate from, and
  // the entrance stagger already covers the initial render.
  const primed = useRef(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const items = Array.from(container.querySelectorAll<HTMLElement>("[data-flip-id]"));
    const next = new Map<string, DOMRect>();
    for (const item of items) {
      next.set(item.dataset.flipId!, item.getBoundingClientRect());
    }

    if (primed.current && !prefersReducedMotion()) {
      for (const item of items) {
        const id = item.dataset.flipId!;
        const before = previous.current.get(id);
        const after = next.get(id);
        // No `before` means the card is new to this view — it fades in via CSS
        // instead, since there is no previous position to travel from.
        if (!before || !after) continue;

        const dx = before.left - after.left;
        const dy = before.top - after.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

        item.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
          {
            duration: 260,
            // ease-out: quick departure, settled arrival.
            easing: "cubic-bezier(.22,.9,.27,1)",
            composite: "replace",
          },
        );
      }
    }

    previous.current = next;
    primed.current = true;
  }, [key]);

  return containerRef;
}
