import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PersonMark } from "./PersonMark";

/**
 * Two letters saying who put something on the list.
 *
 * The whole component is one rule — **nothing when the answer is "you"** — and
 * that rule is what stops it becoming noise on every row of a solo kitchen. It
 * has no way to fail loudly: getting it wrong just makes the list slightly
 * worse-looking, which nobody files a bug about.
 */

const label = (name: string) => `Added by ${name}`;

describe("the person mark", () => {
  it("names somebody else", () => {
    render(<PersonMark userId="u-martina" name="Martina Ruiz" currentUserId="u-nel" label={label} />);

    expect(screen.getByTitle("Added by Martina Ruiz")).toHaveTextContent("MR");
  });

  it("says nothing about you", () => {
    const { container } = render(<PersonMark userId="u-nel" name="Nel" currentUserId="u-nel" label={label} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("says nothing when nobody is recorded", () => {
    // Rows written before the kitchen existed, and rows whose author has since
    // deleted their account.
    const { container } = render(<PersonMark userId={null} name={null} currentUserId="u-nel" label={label} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("still names somebody when the reader is signed out", () => {
    render(<PersonMark userId="u-martina" name="Martina" currentUserId={null} label={label} />);

    expect(screen.getByTitle("Added by Martina")).toBeInTheDocument();
  });

  it("reads the whole sentence to a screen reader, not the initials", () => {
    render(<PersonMark userId="u-martina" name="Martina Ruiz" currentUserId="u-nel" label={label} />);

    expect(screen.getByText("Added by Martina Ruiz")).toHaveClass("sr-only");
  });
});
