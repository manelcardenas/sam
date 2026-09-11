import { describe, expect, it } from "vitest";

import { initialsOf } from "./people";

describe("initialsOf", () => {
  it("takes one letter from a single-word name", () => {
    expect(initialsOf("Manel")).toBe("M");
  });

  it("takes the first and last initial when there is a surname", () => {
    expect(initialsOf("Manel Cárdenas")).toBe("MC");
  });

  it("skips the middle names rather than growing", () => {
    // Two letters is the width the circle is drawn at; three would either
    // overflow or shrink the type below legibility.
    expect(initialsOf("María del Carmen Ruiz")).toBe("MR");
  });

  it("uppercases a name typed in lower case", () => {
    expect(initialsOf("martina")).toBe("M");
  });

  it("keeps the accent, because À and A are different letters to the reader", () => {
    expect(initialsOf("Àlex")).toBe("À");
  });

  it("ignores surrounding and repeated whitespace", () => {
    expect(initialsOf("  Manel   Cárdenas  ")).toBe("MC");
  });

  it("returns nothing for an empty or whitespace-only name", () => {
    expect(initialsOf("")).toBe("");
    expect(initialsOf("   ")).toBe("");
  });

  it("takes a whole code point, not half a surrogate pair", () => {
    // `"𝒜lex".charAt(0)` is a lone high surrogate, which renders as �. A display
    // name is user-chosen text and can legitimately start outside the BMP.
    expect(initialsOf("𝒜lex")).toBe("𝒜");
  });
});
