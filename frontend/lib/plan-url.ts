import type { Meal, PlanStatus } from "@/lib/api-client";

/**
 * The /plan view state, as a query string.
 *
 * calendar  →  /plan                              (this week, yours)
 *           →  /plan?week=2026-09-14              (another week)
 *           →  /plan?plan=<id>                    (a week someone shared with you)
 * slot      →  /plan?slot=2026-09-09:dinner       (the assign sheet, on this week)
 * list      →  /plan?view=list
 *
 * **The week is a view, not a filter**, so paging through weeks pushes history
 * and the device back gesture walks back through them. That is the opposite of
 * `/dine`'s chips, and deliberately: changing the week changes *what you are
 * looking at*, the way opening a recipe does, while a chip narrows what is
 * already on screen (lib/url-state.ts).
 *
 * `week` is always the Saturday. It is absent for the current week so the
 * canonical link to "the plan" stays a bare `/plan` and does not rot into a
 * link to one particular week in the past.
 */

export type PlanView = "calendar" | "list";

export interface PlanSlot {
  date: string; // YYYY-MM-DD
  meal: Meal;
}

export interface PlanUrlState {
  view: PlanView;
  /** Saturday of the week in view, or null for the current one. */
  week: string | null;
  /** The slot whose sheet is open, if any. */
  slot: PlanSlot | null;
  /**
   * A shared plan to show instead of your own, by id. Null means yours.
   *
   * An id rather than the owner's name: names are editable, and a link that
   * stops working because someone renamed themselves is worse than one that
   * shows nothing when access is withdrawn.
   */
  planId: string | null;
}

export const INITIAL_STATE: PlanUrlState = { view: "calendar", week: null, slot: null, planId: null };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MEALS = new Set<string>(["lunch", "dinner"]);

/** The number of days a planned week spans, Saturday through Friday. */
export const DAYS_IN_WEEK = 7;

/**
 * The Saturday on or before `day`, mirroring the backend's `week_start_for`.
 *
 * Saturday because you plan on Saturday and shop on Sunday: the planning day has
 * to open the week being planned, not close the one ending. `getUTCDay()` is 0 on
 * Sunday and 6 on Saturday, so `+1` rotates Saturday to offset 0 and Sunday — the
 * day this most easily gets wrong — to 1.
 *
 * Computed in UTC throughout. Doing it in local time looks identical in most of
 * the world and lands a day out wherever the local midnight has already crossed
 * into the next UTC day; the tests run pinned to Asia/Tokyo for exactly that.
 */
export function weekStartOf(day: Date): string {
  const saturday = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()));
  const offset = (saturday.getUTCDay() + 1) % DAYS_IN_WEEK;
  saturday.setUTCDate(saturday.getUTCDate() - offset);
  return saturday.toISOString().slice(0, 10);
}

/** `days` later than an ISO date, as an ISO date. Pure string in, string out. */
export function shiftDate(iso: string, days: number): string {
  const shifted = new Date(`${iso}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** The Friday that closes the week opened by `weekStart`. */
export function weekEndOf(weekStart: string): string {
  return shiftDate(weekStart, DAYS_IN_WEEK - 1);
}

/** Saturday…Friday of the given week — all seven days, weekend included. */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: DAYS_IN_WEEK }, (_, offset) => shiftDate(weekStart, offset));
}

/**
 * The week the planner should open on, given the calendar week and what state
 * that week's plan is in.
 *
 * **Once the shopping is home, the week you act on is the next one.** You close
 * the list on Sunday evening; everything you think of between then and Friday —
 * the sugar running out, the bin bags — belongs to the next shop, not to a week
 * already archived and read-only. So `list_closed` hands over to the following
 * Saturday and every other state stays put.
 *
 * One hop, never a loop. Two closed weeks in a row means you planned a
 * fortnight ahead, and walking forward until something is open would be the app
 * guessing how far into the future you meant.
 */
export function homeWeekOf(currentWeek: string, status: PlanStatus | null | undefined): string {
  return status === "list_closed" ? shiftDate(currentWeek, DAYS_IN_WEEK) : currentWeek;
}

function isIsoDate(value: string | null): value is string {
  if (value === null || !ISO_DATE.test(value)) return false;
  // A well-formed but impossible date ("2026-02-31") parses to something else
  // entirely. Round-tripping is the cheapest way to reject it.
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function toQuery({ view, week, slot, planId }: PlanUrlState): string {
  const params = new URLSearchParams();
  if (week) params.set("week", week);
  if (planId) params.set("plan", planId);
  if (view === "list") params.set("view", "list");
  // The sheet belongs to the calendar; carrying it into the list would reopen
  // it behind a view that never shows slots.
  if (slot && view === "calendar") params.set("slot", `${slot.date}:${slot.meal}`);
  return params.toString();
}

export function fromQuery(params: URLSearchParams): PlanUrlState {
  const rawWeek = params.get("week");
  // Anything unparseable degrades to the current week rather than rendering an
  // empty one — the same rule /dashboard applies to an unknown category.
  const week = isIsoDate(rawWeek) ? weekStartOf(new Date(`${rawWeek}T00:00:00Z`)) : null;
  const view: PlanView = params.get("view") === "list" ? "list" : "calendar";

  const [date, meal] = (params.get("slot") ?? "").split(":");
  const slot = view === "calendar" && isIsoDate(date ?? null) && MEALS.has(meal) ? { date, meal: meal as Meal } : null;

  // No validation beyond presence: an id that no longer resolves — unshared,
  // or a week the plan was never for — falls back to your own plan at the page
  // level, where the list of what you can actually see is known.
  return { view, week, slot, planId: params.get("plan") || null };
}
