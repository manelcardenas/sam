"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { LOCALES, LOCALE_NAMES, LOCALE_SHORT, type Locale } from "@/lib/i18n/locales";

/**
 * The language switcher: a two-letter code in the header, full names in a menu.
 *
 * **Why not a native `<select>`, unlike the dine sort control.** That one is
 * inline in a filter row where width is cheap, so showing its value as text is
 * free. Here the control sits in a header that already holds the wordmark, the
 * theme toggle, the profile link and sign out — on a 390px phone there is about
 * 100px of slack, and a `<select>` wide enough to read "Español" spends all of
 * it. A 44px trigger costs nothing and stays 44px when a fourth language
 * arrives. The trade is real: this gives up iOS's wheel picker and the free
 * keyboard behaviour, so both are implemented below rather than assumed.
 *
 * **The code, not a globe.** A globe alone would be smaller still, but it can't
 * say *which* language is active — and "what language am I in?" is the one
 * question this control exists to answer at a glance. Set in the display font
 * with wide tracking so two capitals read as a deliberate mark rather than
 * cramped text, and sized to match `ThemeToggle` exactly so the two read as a
 * pair of header controls rather than two unrelated widgets.
 */
export function LanguageToggle({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // Close on an outside press or on Escape, and hand focus back to the trigger
  // when Escape does it — leaving focus on a menu that no longer exists is how
  // a keyboard user gets stranded.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choose = (next: Locale) => {
    setLocale(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  /** Arrow keys walk the menu; Home/End jump. */
  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    const jump = event.key === "Home" ? 0 : event.key === "End" ? LOCALES.length - 1 : null;
    if (!step && jump === null) return;
    event.preventDefault();

    const items = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']") ?? [])];
    const from = items.findIndex((item) => item === document.activeElement);
    const to =
      jump !== null ? jump : (from + step + items.length) % items.length;
    items[to]?.focus();
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        // The visible text is two letters, so the accessible name has to say
        // what they are for — and name the current language, since "EN" alone
        // is not obviously a language to a screen reader.
        aria-label={`${t("shell.language")}: ${LOCALE_NAMES[locale]}`}
        title={t("shell.language")}
        className={`flex h-11 w-11 items-center justify-center rounded-full font-display text-[0.8rem] font-bold uppercase tracking-[0.08em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 ${
          open ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg"
        }`}
      >
        {LOCALE_SHORT[locale]}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={t("shell.language")}
          onKeyDown={onMenuKeyDown}
          // Right-aligned: the trigger is near the right edge of the header, so
          // a left-aligned panel would hang off the screen on a phone.
          className="absolute right-0 top-full z-40 mt-2 min-w-[10rem] overflow-hidden rounded-2xl border border-line bg-surface p-1 shadow-paw will-fetch animate-fetch-in"
        >
          {LOCALES.map((code) => {
            const on = code === locale;
            return (
              <button
                key={code}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                onClick={() => choose(code)}
                className={`flex h-11 w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 text-left text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 ${
                  on ? "bg-tomato/10 text-tomato" : "text-fg hover:bg-surface-2"
                }`}
              >
                {/* The code again, as a fixed-width gutter, so the names line
                    up and the menu reads as a list rather than ragged text. */}
                <span
                  className={`w-6 shrink-0 font-display text-[0.7rem] font-bold uppercase tracking-[0.08em] ${
                    on ? "text-tomato" : "text-muted"
                  }`}
                  aria-hidden
                >
                  {LOCALE_SHORT[code]}
                </span>
                {/* Each name in its own language: someone looking for theirs
                    scans for the word they would use for it, which is the one
                    case where not translating a string is correct. */}
                <span className="min-w-0 flex-1 truncate">{LOCALE_NAMES[code]}</span>
                {on && <Check className="h-4 w-4 shrink-0" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
