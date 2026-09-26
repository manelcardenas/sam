import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";

import { DOUBLE_CLICK_MS, onSingleClick } from "./map-style";

/** Just enough of a MapLibre map to fire events at. */
function fakeMap() {
  const listeners = new Map<string, ((e?: unknown) => void)[]>();
  const map = {
    on: (type: string, fn: (e?: unknown) => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
  } as unknown as MapLibreMap;
  const fire = (type: string, e?: unknown) => listeners.get(type)?.forEach((fn) => fn(e));
  return { map, fire };
}

const at = (lng: number) => ({ lngLat: { lng, lat: 0 } }) as unknown as MapMouseEvent;

describe("onSingleClick", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lets a lone click through once it is clearly not a double-click", () => {
    const { map, fire } = fakeMap();
    const handler = vi.fn();
    onSingleClick(map, handler);

    fire("click", at(1));
    expect(handler).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DOUBLE_CLICK_MS);
    expect(handler).toHaveBeenCalledWith(at(1));
  });

  it("swallows both clicks of a double-click — that is the zoom gesture", () => {
    const { map, fire } = fakeMap();
    const handler = vi.fn();
    onSingleClick(map, handler);

    // What MapLibre fires for a double-click.
    fire("click", at(1));
    vi.advanceTimersByTime(120);
    fire("click", at(1));
    fire("dblclick");
    vi.advanceTimersByTime(DOUBLE_CLICK_MS * 2);

    expect(handler).not.toHaveBeenCalled();
  });

  it("never fires into a map that has been removed", () => {
    const { map, fire } = fakeMap();
    const handler = vi.fn();
    onSingleClick(map, handler);

    fire("click", at(1));
    fire("remove");
    vi.advanceTimersByTime(DOUBLE_CLICK_MS);

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("onSingleClick with a preview", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the pin at once, before the click is known to be single", () => {
    const { map, fire } = fakeMap();
    const show = vi.fn();
    const handler = vi.fn();
    onSingleClick(map, handler, { show, undo: vi.fn() });

    fire("click", at(1));
    expect(show).toHaveBeenCalledWith(at(1));
    expect(handler).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DOUBLE_CLICK_MS);
    expect(handler).toHaveBeenCalledWith(at(1));
  });

  it("puts the pin back when it turns out to be a double-click", () => {
    const { map, fire } = fakeMap();
    const undo = vi.fn();
    const handler = vi.fn();
    onSingleClick(map, handler, { show: vi.fn(), undo });

    fire("click", at(1));
    fire("click", at(1));
    fire("dblclick");
    vi.advanceTimersByTime(DOUBLE_CLICK_MS * 2);

    expect(undo).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not undo a pin that has already settled", () => {
    const { map, fire } = fakeMap();
    const undo = vi.fn();
    onSingleClick(map, vi.fn(), { show: vi.fn(), undo });

    fire("click", at(1));
    vi.advanceTimersByTime(DOUBLE_CLICK_MS);
    // A later, unrelated double-click elsewhere: nothing pending to undo.
    fire("dblclick");

    expect(undo).not.toHaveBeenCalled();
  });
});
