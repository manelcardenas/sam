/**
 * Shared formatting for dates the scrapbook shows.
 *
 * Every function takes an explicit `locale`. They used to pass `undefined`,
 * which means "the browser's locale" — so choosing Catalan in the app would
 * still have produced English dates. The app's own language has to win, since
 * it is the more specific statement of intent.
 */

/**
 * Render a date-only "YYYY-MM-DD" in the viewer's locale without the UTC-midnight
 * shift of `new Date(string)` — which lands on the previous day west of UTC.
 */
export function parseDateOnly(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatVisitedDate(isoDate: string, locale: string): string {
  return parseDateOnly(isoDate).toLocaleDateString(locale);
}

/** "September 2025" — month precision, for "member since". */
export function formatMonthYear(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(locale, { month: "long", year: "numeric" });
}

/** A full date, for the created/updated line on a recipe. */
export function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(locale);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "3 weeks ago" — the scrapbook reads better in elapsed time than in dates.
 *
 * Uses Intl.RelativeTimeFormat so it localises, and compares at day granularity
 * (both sides floored to local midnight) so a visit logged this morning says
 * "today" rather than "8 hours ago" — visits are day-precision facts.
 */
export function formatRelativeDate(
  isoDate: string,
  locale: string,
  now: Date = new Date(),
): string {
  const then = parseDateOnly(isoDate);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((then.getTime() - today.getTime()) / DAY);

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(days);

  if (abs === 0) return rtf.format(0, "day"); // "today"
  if (abs < 7) return rtf.format(days, "day");
  if (abs < 31) return rtf.format(Math.round(days / 7), "week");
  if (abs < 365) return rtf.format(Math.round(days / 30), "month");
  return rtf.format(Math.round(days / 365), "year");
}

/**
 * Joins reviewer names the way a person would: "Nel", "Nel + Martina",
 * "Nel + Martina + 2 more". Kept short because it shares a line with the date.
 *
 * `more` is passed in already translated rather than looked up here, so this
 * module stays free of the dictionary and testable without a provider.
 */
export function formatReviewers(
  names: string[],
  more: (n: number) => string,
  max = 2,
): string | null {
  if (names.length === 0) return null;
  if (names.length <= max) return names.join(" + ");
  return `${names.slice(0, max).join(" + ")} + ${more(names.length - max)}`;
}
