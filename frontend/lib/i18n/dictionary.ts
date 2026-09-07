import ca from "@/messages/ca.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

import type { Locale } from "./locales";

/**
 * The three copy files, and the types that keep them honest.
 *
 * **`en.json` is the shape.** `es` and `ca` are declared as `typeof en`, so a
 * key that exists in English and is missing from a translation is a *type
 * error*, not a blank label discovered in production. Adding a string means
 * adding it to all three files; there is no silent fallback, deliberately —
 * a fallback is how half-translated apps stay half-translated.
 *
 * **Why not i18next.** The app is `output: 'export'`, so the locale routing and
 * server rendering those libraries are built around are unavailable; what would
 * be left is their runtime, at roughly 40 kB against a 102 kB shared bundle,
 * to do interpolation and plural selection. Interpolation is a regex, and
 * plural selection is `Intl.PluralRules` — which is in the browser, knows all
 * three languages, and stays right for any language added later. What a library
 * would genuinely add is tooling for non-technical translators; nobody is doing
 * that here.
 *
 * **All three files are imported statically**, so switching language is
 * instant with no loading state and no flash. At ~180 strings each that is a
 * few kB gzipped — the right trade at this size. If the copy ever grows by an
 * order of magnitude, this is the line to revisit.
 */
const DICTIONARIES: Record<Locale, typeof en> = {
  en,
  es: es as typeof en,
  ca: ca as typeof en,
};

// ── Key types, derived from the English file ────────────────────────────────

/** A value that carries plural forms rather than one string. `other` is required. */
type PluralForms = { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>;

type IsPlural<T> = T extends { other: string } ? true : false;

/** Dotted paths to plain string leaves. */
type StringPaths<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : IsPlural<T[K]> extends true
      ? never
      : `${K}.${StringPaths<T[K]>}`;
}[keyof T & string];

/** Dotted paths to plural-form leaves. */
type PluralPaths<T> = {
  [K in keyof T & string]: T[K] extends string
    ? never
    : IsPlural<T[K]> extends true
      ? K
      : `${K}.${PluralPaths<T[K]>}`;
}[keyof T & string];

export type MessageKey = StringPaths<typeof en>;
export type PluralKey = PluralPaths<typeof en>;

/** Values substituted into `{{placeholders}}`. */
export type Vars = Record<string, string | number>;

// ── Lookup ─────────────────────────────────────────────────────────────────

function lookup(locale: Locale, key: string): unknown {
  let node: unknown = DICTIONARIES[locale];
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/**
 * Substitutes `{{name}}` placeholders.
 *
 * A placeholder with no matching variable is left as-is rather than replaced
 * with "undefined": the literal `{{count}}` on screen is an obvious bug report,
 * whereas "undefined recipes" looks like a data problem and gets misfiled.
 */
function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/**
 * The types make a missing key impossible from TypeScript, but a hand-built key
 * or a stale cached JSON could still miss. Returning the key itself makes that
 * visible on screen and greppable, rather than rendering an empty element.
 */
function orKey(value: unknown, key: string): string {
  return typeof value === "string" ? value : key;
}

export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  return interpolate(orKey(lookup(locale, key), key), vars);
}

/**
 * Picks the plural form for `count` using the locale's own rules, then
 * interpolates — with `count` always available as `{{count}}`.
 *
 * Falls back to `other` when the selected category isn't authored. Spanish and
 * Catalan both have a `many` category that English lacks, but it only applies
 * from 1,000,000 up, so authoring `one`/`other` is enough in practice and the
 * fallback keeps it correct if that ever stops being true.
 */
export function translatePlural(
  locale: Locale,
  key: PluralKey,
  count: number,
  vars?: Vars,
): string {
  const forms = lookup(locale, key);
  if (typeof forms !== "object" || forms === null) return key;
  const category = new Intl.PluralRules(locale).select(count);
  const chosen = (forms as PluralForms)[category] ?? (forms as PluralForms).other;
  return interpolate(orKey(chosen, key), { count, ...vars });
}
