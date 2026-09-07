"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  isLocale,
  resolveInitialLocale,
  type Locale,
} from "./locales";
import {
  translate,
  translatePlural,
  type MessageKey,
  type PluralKey,
  type Vars,
} from "./dictionary";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  /** A plain string. Interpolates `{{vars}}`. */
  t: (key: MessageKey, vars?: Vars) => string;
  /** A pluralised string. `count` is always available as `{{count}}`. */
  tp: (key: PluralKey, count: number, vars?: Vars) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Holds the chosen language for the whole session.
 *
 * Mirrors `ThemeToggle`'s shape on purpose, because it is the same problem: a
 * user preference that has to survive a refresh in an app with no server
 * (`output: 'export'` rules out locale routing and middleware). The choice
 * lives in `localStorage` and the pre-paint script in `layout.tsx` applies it
 * to `<html lang>` before the first frame.
 *
 * **Why the first render is always the default locale.** Reading
 * `localStorage` in the initial state would make the server-rendered HTML and
 * the client's first render disagree — a hydration mismatch. So the stored
 * choice is applied in an effect instead. That is invisible here because every
 * page renders its content behind the auth gate, so there is no translated copy
 * in the prerendered HTML for the switch to visibly correct (the one exception
 * is the document title, which is handled in `layout.tsx`).
 */
export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      /* storage may be unavailable — fall through to the browser's languages */
    }
    const resolved = resolveInitialLocale(stored, navigator.languages ?? [navigator.language]);
    setLocaleState(resolved);
    document.documentElement.lang = resolved;
  }, []);

  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    setLocaleState(next);
    // `lang` drives the browser's own hyphenation, spellcheck and, more
    // importantly, how a screen reader pronounces the page. Keeping it in step
    // is not decoration.
    document.documentElement.lang = next;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      /* the switch still works for this session */
    }
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
      tp: (key, count, vars) => translatePlural(locale, key, count, vars),
    }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * The translation function, plus the current locale.
 *
 * Throws rather than falling back to English when used outside the provider: a
 * component rendering untranslated copy is a wiring bug, and silently working
 * is how it would reach production.
 */
export function useI18n(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useI18n must be used inside <LocaleProvider>");
  return ctx;
}
