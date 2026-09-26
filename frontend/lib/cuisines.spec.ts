import { describe, expect, it } from "vitest";

import { contrast, cuisineAccent, pinColors } from "./cuisines";

describe("pinColors", () => {
  it("paints the pin with the first cuisine, as the card's first dot does", () => {
    expect(pinColors(["Chinese", "Spanish"]).background).toBe(cuisineAccent("Chinese"));
  });

  it("falls back to a fixed neutral for Other, untagged and unknown places", () => {
    const neutral = pinColors([]).background;
    expect(neutral).toMatch(/^#[0-9A-F]{6}$/i);
    expect(pinColors(["Other"]).background).toBe(neutral);
    expect(pinColors(["Klingon"]).background).toBe(neutral);
  });

  it("keeps white text wherever white stays readable", () => {
    expect(pinColors(["Chinese"]).ink).toBe("#FFFFFF");
    expect(pinColors(["Mexican"]).ink).toBe("#FFFFFF");
  });

  it("switches to ink on amber, where white would fall below 3:1", () => {
    expect(pinColors(["Spanish"]).ink).toBe("#1A1A1A");
  });

  it("never paints a pin whose text is below 3:1", () => {
    for (const c of ["Chinese", "Spanish", "Mediterranean", "Italian", "Japanese", "Mexican", "Thai", "Indian", "French", "American", "Vegan/Vegetarian", "Other"]) {
      const { background, ink } = pinColors([c]);
      expect(contrast(background, ink), c).toBeGreaterThanOrEqual(3);
    }
  });
});
