import { describe, expect, it } from "vitest";

import { formatDayAndMonth, formatWeekRange, parseDateOnly } from "./format";

/**
 * Dates, and specifically the order the parts come in.
 *
 * These exist because the week heading used to be assembled by hand — a day, a
 * dash, a day-and-month — which quietly assumed every language writes the day
 * first. English does not, so an English week read "12 – Sep 18": a string that
 * is not a date range in any locale. The assertions below are about ordering
 * and about the month appearing exactly where the language wants it, not about
 * the exact abbreviation, which is `Intl`'s to choose and changes with ICU.
 */

const MON = "2026-09-12";
const FRI = "2026-09-18";

describe("a week's heading", () => {
  it("puts the day before the month in English", () => {
    // The bug this file was written for: en alone means en-US to Intl.
    expect(formatWeekRange(MON, FRI, "en")).toMatch(/^12\s*[–-]\s*18\s/);
  });

  it("names the month once when both ends share it", () => {
    const heading = formatWeekRange(MON, FRI, "en");

    expect(heading).toMatch(/^12/);
    expect(heading.match(/\d+/g)).toEqual(["12", "18"]);
  });

  it("names the month on both ends when the week crosses one", () => {
    // "28 Sep – 2 Oct". Dropping the first month here would read as a five-day
    // September week.
    const heading = formatWeekRange("2026-09-28", "2026-10-02", "en");

    expect(heading).toMatch(/^28\s*\S+\s*[–-]\s*2\s*\S+$/);
    expect(heading).not.toBe(formatWeekRange("2026-09-28", "2026-09-02", "en"));
  });

  it("keeps the day first in Spanish and Catalan too", () => {
    for (const locale of ["es", "ca"]) expect(formatWeekRange(MON, FRI, locale)).toMatch(/^12/);
  });

  it("uses each language's own month name", () => {
    const [en, es] = [formatWeekRange(MON, FRI, "en"), formatWeekRange(MON, FRI, "es")];

    expect(en.toLowerCase()).toContain("sep");
    expect(es).not.toBe(en);
  });
});

describe("a day under a weekday", () => {
  it("puts the day first in English", () => {
    expect(formatDayAndMonth("2026-09-09", "en")).toMatch(/^9\s/);
  });
});

describe("parsing a date-only string", () => {
  it("lands on the day written, not the one before it", () => {
    // `new Date("2026-09-12")` is UTC midnight, which is 11 September anywhere
    // west of Greenwich.
    const date = parseDateOnly("2026-09-12");

    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 8, 12]);
  });
});
