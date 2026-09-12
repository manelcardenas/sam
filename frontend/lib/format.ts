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

/**
 * The BCP-47 tag to format dates with, for one of the app's languages.
 *
 * `Intl` reads a bare `en` as American English, which puts the month first:
 * "Sep 12", and "Sep 12 – 18" for a range. Everyone who reads this app writes
 * the day first, and so does every other language it speaks — so `en` on its
 * own was the odd one out rather than the neutral choice. `en-GB` is the same
 * English with the ordering the app actually means, which is cheaper and more
 * correct than assembling the parts by hand.
 */
function dateLocale(locale: string): string {
  return locale === "en" ? "en-GB" : locale;
}

/**
 * "Mon" — the planner's day column heading.
 *
 * Short rather than long because five of these sit side by side on a phone;
 * `narrow` was rejected because Catalan renders Tuesday and Wednesday both as
 * "d", and Spanish gives "m" to Tuesday and Wednesday alike.
 */
export function formatWeekday(isoDate: string, locale: string): string {
  return parseDateOnly(isoDate).toLocaleDateString(dateLocale(locale), { weekday: "short" });
}

/** "9 Sep" — the date under a weekday, so a week in the past is identifiable. */
export function formatDayAndMonth(isoDate: string, locale: string): string {
  return parseDateOnly(isoDate).toLocaleDateString(dateLocale(locale), { day: "numeric", month: "short" });
}

/**
 * "12–18 Sep" / "28 Sep – 2 Oct" — the week's own heading.
 *
 * `formatRange` rather than two `format` calls joined by a dash. Building it by
 * hand meant deciding where the month goes and when to drop it from the first
 * half, and that decision is not ours to make: it is a property of the language.
 * Getting it wrong printed "12 – Sep 18" in English, which is not a date range
 * in any locale. `Intl` already knows all of it — which half keeps the month,
 * which dash the language uses, and that it tightens to "12–18" when both ends
 * share a month but stays spaced across a month boundary.
 */
export function formatWeekRange(weekStart: string, weekEnd: string, locale: string): string {
  return new Intl.DateTimeFormat(dateLocale(locale), { day: "numeric", month: "short" }).formatRange(
    parseDateOnly(weekStart),
    parseDateOnly(weekEnd),
  );
}

export function formatVisitedDate(isoDate: string, locale: string): string {
  return parseDateOnly(isoDate).toLocaleDateString(dateLocale(locale));
}

/** "September 2025" — month precision, for "member since". */
export function formatMonthYear(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(dateLocale(locale), { month: "long", year: "numeric" });
}

/** A full date, for the created/updated line on a recipe. */
export function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(dateLocale(locale));
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

  const rtf = new Intl.RelativeTimeFormat(dateLocale(locale), { numeric: "auto" });
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
