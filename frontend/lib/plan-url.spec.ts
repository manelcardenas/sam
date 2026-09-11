import { describe, expect, it } from "vitest";
import { INITIAL_STATE, fromQuery, homeWeekOf, shiftDate, toQuery, weekDays, weekEndOf, weekStartOf, type PlanUrlState } from "./plan-url";

function roundTrip(state: PlanUrlState): PlanUrlState {
  return fromQuery(new URLSearchParams(toQuery(state)));
}

describe("toQuery / fromQuery round trip", () => {
  it("renders the current week as a bare URL", () => {
    // The canonical link to "the plan" must not rot into a link to one
    // particular week in the past.
    expect(toQuery(INITIAL_STATE)).toBe("");
    expect(roundTrip(INITIAL_STATE)).toEqual(INITIAL_STATE);
  });

  it("restores another week", () => {
    const state: PlanUrlState = { view: "calendar", week: "2026-09-12", slot: null, planId: null };
    expect(toQuery(state)).toBe("week=2026-09-12");
    expect(roundTrip(state)).toEqual(state);
  });

  it("restores the list view", () => {
    const state: PlanUrlState = { view: "list", week: null, slot: null, planId: null };
    expect(toQuery(state)).toBe("view=list");
    expect(roundTrip(state)).toEqual(state);
  });

  it("restores an open slot", () => {
    const state: PlanUrlState = { view: "calendar", week: null, slot: { date: "2026-09-09", meal: "dinner" }, planId: null };
    expect(toQuery(state)).toBe("slot=2026-09-09%3Adinner");
    expect(roundTrip(state)).toEqual(state);
  });

  it("restores a slot on a week that isn't this one", () => {
    const state: PlanUrlState = { view: "calendar", week: "2026-09-12", slot: { date: "2026-09-16", meal: "lunch" }, planId: null };
    expect(roundTrip(state)).toEqual(state);
  });

  it("drops the slot when the list is in view", () => {
    // The sheet belongs to the calendar; reopening it behind a view that never
    // shows slots would trap the user behind an invisible modal.
    const state: PlanUrlState = { view: "list", week: null, slot: { date: "2026-09-09", meal: "lunch" }, planId: null };
    expect(toQuery(state)).toBe("view=list");
    expect(roundTrip(state).slot).toBeNull();
  });
});

describe("degrading rather than rendering nothing", () => {
  it.each(["", "banana", "2026-9-1", "2026-02-31", "not-a-date"])("treats %j as the current week", (raw) => {
    expect(fromQuery(new URLSearchParams(`week=${raw}`)).week).toBeNull();
  });

  it("normalises a mid-week date to its Saturday", () => {
    // Two links to "that week" written on different days must open the same
    // week rather than two.
    expect(fromQuery(new URLSearchParams("week=2026-09-10")).week).toBe("2026-09-05");
  });

  it.each(["2026-09-09", "2026-09-09:brunch", "garbage:lunch", ":lunch"])("ignores an unusable slot %j", (raw) => {
    expect(fromQuery(new URLSearchParams(`slot=${raw}`)).slot).toBeNull();
  });
});

describe("weekStartOf", () => {
  // The week of Saturday 5 September 2026, which runs Sat 5 → Fri 11.
  it.each([
    ["2026-09-05", "Saturday"],
    ["2026-09-06", "Sunday"],
    ["2026-09-09", "Wednesday"],
    ["2026-09-11", "Friday"],
  ])("resolves %s (%s) to the Saturday on or before it", (iso) => {
    expect(weekStartOf(new Date(`${iso}T00:00:00Z`))).toBe("2026-09-05");
  });

  it("puts Sunday at the start of its week, not the end", () => {
    // The one the Monday convention got the other way round, and the reason the
    // change is worth testing rather than eyeballing: you plan on Saturday and
    // shop on Sunday, so Sunday has to belong to the week you just planned.
    expect(weekStartOf(new Date("2026-09-06T00:00:00Z"))).toBe("2026-09-05");
  });

  it("starts a new week on Saturday rather than extending the old one", () => {
    // The boundary. Off by one here and the grid quietly starts on Sunday.
    expect(weekStartOf(new Date("2026-09-12T00:00:00Z"))).toBe("2026-09-12");
  });

  it("agrees with the backend about which week a date is in", () => {
    // Mirrors `week_start_for` in src/domain/entities/meal_plan.py. If these two
    // disagree, the client asks for one week and the server answers with another
    // — and both look internally consistent.
    const backend = (iso: string) => {
      const day = new Date(`${iso}T00:00:00Z`);
      // Python's date.weekday(): Monday 0 … Sunday 6.
      const pythonWeekday = (day.getUTCDay() + 6) % 7;
      day.setUTCDate(day.getUTCDate() - ((pythonWeekday - 5 + 7) % 7));
      return day.toISOString().slice(0, 10);
    };
    for (let offset = 0; offset < 30; offset += 1) {
      const iso = shiftDate("2026-09-01", offset);
      expect(weekStartOf(new Date(`${iso}T00:00:00Z`))).toBe(backend(iso));
    }
  });

  it("does not shift a date because of the local timezone", () => {
    // Built from local y/m/d into a UTC date on purpose: `new Date(iso)` parses
    // as UTC and then renders in local time, so the whole week can slide by one.
    // These run pinned to Asia/Tokyo (vitest.config.mts), where a local-time
    // implementation fails by a whole week rather than passing by luck.
    expect(weekStartOf(new Date(2026, 8, 5, 23, 30))).toBe("2026-09-05");
    expect(weekStartOf(new Date(2026, 8, 5, 0, 15))).toBe("2026-09-05");
  });
});

describe("weekDays", () => {
  it("is Saturday to Friday, all seven days", () => {
    expect(weekDays("2026-09-05")).toEqual([
      "2026-09-05",
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
    ]);
  });

  it("crosses a month boundary without arithmetic errors", () => {
    expect(weekDays("2026-09-26")).toEqual([
      "2026-09-26",
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
  });

  it("tiles with the next week, leaving no day in two weeks and none in neither", () => {
    const first = weekDays("2026-09-05");
    const second = weekDays("2026-09-12");

    expect(new Set([...first, ...second]).size).toBe(14);
    expect(weekEndOf("2026-09-05")).toBe("2026-09-11");
    expect(shiftDate(weekEndOf("2026-09-05"), 1)).toBe(second[0]);
  });
});

describe("shiftDate", () => {
  it("crosses a year boundary", () => {
    expect(shiftDate("2026-12-28", 7)).toBe("2027-01-04");
  });

  it("goes backwards", () => {
    expect(shiftDate("2026-09-07", -7)).toBe("2026-08-31");
  });

  it("is unaffected by daylight saving", () => {
    // Europe/Madrid ends DST on 2026-10-25. A local-time implementation lands
    // on 23:00 the previous day and truncates to the wrong date.
    expect(shiftDate("2026-10-19", 7)).toBe("2026-10-26");
  });
});

describe("viewing a week someone shared", () => {
  it("encodes the plan id", () => {
    const state: PlanUrlState = { view: "calendar", week: null, slot: null, planId: "p-123" };
    expect(toQuery(state)).toBe("plan=p-123");
    expect(roundTrip(state)).toEqual(state);
  });

  it("survives alongside a week and a view", () => {
    const state: PlanUrlState = { view: "list", week: "2026-09-12", slot: null, planId: "p-123" };
    expect(roundTrip(state)).toEqual(state);
  });

  it("is absent for your own plan, so /plan stays the canonical link", () => {
    expect(toQuery(INITIAL_STATE)).toBe("");
  });

  it("treats an empty value as your own plan", () => {
    expect(fromQuery(new URLSearchParams("plan=")).planId).toBeNull();
  });
});

describe("the week the planner opens on", () => {
  const THIS_WEEK = "2026-09-05"; // Saturday
  const NEXT_WEEK = "2026-09-12";

  it("stays on this week while it is still being planned", () => {
    expect(homeWeekOf(THIS_WEEK, "planning")).toBe(THIS_WEEK);
  });

  it("stays on this week while you are still shopping for it", () => {
    // `calendar_closed` *is* the shopping state — the list is still live, and
    // moving on from it would hide the list you are holding in the shop.
    expect(homeWeekOf(THIS_WEEK, "calendar_closed")).toBe(THIS_WEEK);
  });

  it("hands over to the next shop once the list is closed", () => {
    expect(homeWeekOf(THIS_WEEK, "list_closed")).toBe(NEXT_WEEK);
  });

  it("stays put when the week has no plan at all", () => {
    // Nothing planned is not the same as nothing left to do: an unplanned week
    // is exactly the one you have come to plan.
    expect(homeWeekOf(THIS_WEEK, null)).toBe(THIS_WEEK);
    expect(homeWeekOf(THIS_WEEK, undefined)).toBe(THIS_WEEK);
  });

  it("hops exactly one week, never further", () => {
    // Even if next week is closed too, the caller asks once. Walking forward
    // until something is open would be guessing how far ahead you meant.
    expect(homeWeekOf(homeWeekOf(THIS_WEEK, "list_closed"), undefined)).toBe(NEXT_WEEK);
  });

  it("lands on a Saturday", () => {
    expect(weekStartOf(new Date(`${homeWeekOf(THIS_WEEK, "list_closed")}T00:00:00Z`))).toBe(NEXT_WEEK);
  });
});
