import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLivePlan } from "@/lib/useLivePlan";

/**
 * The four gates, each tested by showing the refresh does *not* happen.
 *
 * Every one of them is there to keep the request count down, and a gate that
 * quietly stopped working would not break anything visible — the list would
 * simply be more expensive and the phone warmer. Nothing would ever fail.
 */

const POLL_MS = 20_000;
const IDLE_AFTER_MS = 5 * 60_000;

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useLivePlan", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls while the list is open and somebody else is in the kitchen", () => {
    const onRefresh = vi.fn();
    renderHook(() => useLivePlan({ enabled: true, onRefresh }));

    act(() => void vi.advanceTimersByTime(POLL_MS * 3));

    expect(onRefresh).toHaveBeenCalledTimes(3);
  });

  it("does nothing at all when disabled", () => {
    // The caller's gates — the calendar view, and a kitchen of one. Neither has
    // a second person who could change anything.
    const onRefresh = vi.fn();
    renderHook(() => useLivePlan({ enabled: false, onRefresh }));

    act(() => void vi.advanceTimersByTime(POLL_MS * 5));

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("stops while the tab is hidden and picks up again when it comes back", () => {
    const onRefresh = vi.fn();
    renderHook(() => useLivePlan({ enabled: true, onRefresh }));

    act(() => setVisibility("hidden"));
    act(() => void vi.advanceTimersByTime(POLL_MS * 3));
    expect(onRefresh).not.toHaveBeenCalled();

    act(() => setVisibility("visible"));

    // The one on becoming visible again — the moment the list is most likely to
    // be stale is the moment somebody looks at it.
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("stops once nobody has touched the page for a few minutes", () => {
    const onRefresh = vi.fn();
    renderHook(() => useLivePlan({ enabled: true, onRefresh }));

    act(() => void vi.advanceTimersByTime(IDLE_AFTER_MS + POLL_MS));
    const whileSomebodyWasThere = onRefresh.mock.calls.length;

    act(() => void vi.advanceTimersByTime(POLL_MS * 5));

    expect(onRefresh).toHaveBeenCalledTimes(whileSomebodyWasThere);
    expect(whileSomebodyWasThere).toBeGreaterThan(0);
  });

  it("starts again the moment the page is touched", () => {
    const onRefresh = vi.fn();
    renderHook(() => useLivePlan({ enabled: true, onRefresh }));
    act(() => void vi.advanceTimersByTime(IDLE_AFTER_MS + POLL_MS * 2));
    const beforeTouch = onRefresh.mock.calls.length;

    act(() => document.dispatchEvent(new Event("pointerdown")));
    act(() => void vi.advanceTimersByTime(POLL_MS));

    expect(onRefresh.mock.calls.length).toBe(beforeTouch + 1);
  });

  it("refetches when the window regains focus", () => {
    const onRefresh = vi.fn();
    renderHook(() => useLivePlan({ enabled: true, onRefresh }));

    act(() => void window.dispatchEvent(new Event("focus")));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not keep polling after the page has gone", () => {
    const onRefresh = vi.fn();
    const { unmount } = renderHook(() => useLivePlan({ enabled: true, onRefresh }));

    unmount();
    act(() => void vi.advanceTimersByTime(POLL_MS * 3));
    act(() => void window.dispatchEvent(new Event("focus")));

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("uses the newest callback rather than the one it started with", () => {
    // The refresh closes over the week on screen. Restarting the interval to
    // pick up a new one would reset the countdown on every render; keeping the
    // old one would refetch a week nobody is looking at.
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ onRefresh }) => useLivePlan({ enabled: true, onRefresh }), {
      initialProps: { onRefresh: first },
    });

    rerender({ onRefresh: second });
    act(() => void vi.advanceTimersByTime(POLL_MS));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
