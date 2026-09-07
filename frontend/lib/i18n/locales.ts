/**
 * The languages the app speaks.
 *
 * English is the default and the source of truth: **all copy is authored in
 * English in `messages/en.json`**, and `es`/`ca` are translations of it. The
 * codebase itself contains no Spanish — that was not true before this change
 * (`FOOD_TYPES` shipped Spanish labels and several placeholders were Spanish
 * examples inside an English UI), and fixing it is half the work here.
 */
export const LOCALES = ["en", "es", "ca"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Shown in the language switcher. Each name is written in its own language. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
  ca: "Català",
};

/**
 * Two letters, for the header trigger.
 *
 * The switcher shows only this, so the control stays the same size as the
 * theme toggle beside it — the full name in `LOCALE_NAMES` appears in the menu,
 * where there is room for it.
 */
export const LOCALE_SHORT: Record<Locale, string> = {
  en: "EN",
  es: "ES",
  ca: "CA",
};

export const LOCALE_STORAGE_KEY = "sam-locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * The locale to start in: a previous explicit choice, else the closest match to
 * the browser's languages, else English.
 *
 * Matching is on the language subtag only, so `es-AR` and `es-419` both find
 * Spanish. Catalan is checked the same way — a `ca-ES` browser gets Catalan
 * rather than falling through to Spanish, which would be the wrong guess for
 * someone who has explicitly set Catalan.
 */
export function resolveInitialLocale(
  stored: string | null,
  browserLanguages: readonly string[],
): Locale {
  if (isLocale(stored)) return stored;
  for (const tag of browserLanguages) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
