"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, UserRound } from "lucide-react";

import { useI18n } from "@/lib/i18n/LocaleProvider";
import { initialsOf } from "@/lib/people";
import type { RecipeAuthor } from "@/lib/recipe-filters";

/**
 * "Created by" — a labelled multi-select over the people who wrote the recipes.
 *
 * **Why not one chip per person.** Chips are a flat, always-visible vocabulary:
 * fine for four categories, unusable at ten names. They push everything else out
 * of a horizontally scrolling row, they give no clue how many people exist until
 * you scroll, and there is nowhere to put a label saying what the row *is*. This
 * spends one control's worth of space regardless of how many people there are,
 * and says what it filters on before you open it — which is the difference
 * between a filter you find and one you stumble into.
 *
 * **Why a rounded rectangle next to round pills.** `Chip.tsx` writes the rule
 * down: the app uses fully-round pills for things that toggle and rounded
 * rectangles for things that hold a value. This holds a value, so the shape is
 * already decided, and the shape is exactly what tells a reader at a glance that
 * it behaves differently from the category chips beside it.
 *
 * **Why the panel is portalled.** It renders inside `rail-scroll`
 * (`overflow-x: auto`) on /dashboard and inside the slot sheet's own
 * `overflow-y: auto`. An absolutely-positioned panel is clipped by both — the
 * one place this diverges from `LanguageToggle`, and not by preference.
 * Positioning is therefore computed from the trigger's rect and re-run while
 * open, which is also what lets it flip above the trigger near the bottom of a
 * phone screen instead of opening off-screen.
 *
 * Keyboard: ↑↓ walk, Home/End jump, Enter/Space toggles without closing (it is
 * multi-select — closing after each pick would make choosing three people cost
 * three round trips), Escape closes and returns focus to the trigger.
 */

/** Gutter kept between the panel and the viewport edge, in px. */
const EDGE = 12;
const PANEL_WIDTH = 288; // 18rem
/** Above this many people, scanning beats reading and the panel gets a search box. */
const SEARCHABLE_FROM = 8;

interface Position {
  top: number;
  left: number;
  /** Space available for the panel, so the list scrolls instead of overflowing. */
  maxHeight: number;
}

export function AuthorSelect({
  authors,
  selected,
  onChange,
  currentUserId,
}: {
  authors: RecipeAuthor[];
  selected: string[];
  onChange: (next: string[]) => void;
  currentUserId: string | null;
}) {
  const { t, tp } = useI18n();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [needle, setNeedle] = useState("");
  const [position, setPosition] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - EDGE * 2;
    const above = rect.top - EDGE * 2;
    // Flip only when below genuinely cannot hold a useful panel *and* above is
    // roomier. Flipping on a few pixels makes the panel jump around as the page
    // scrolls, which is worse than a slightly short list.
    const flip = below < 240 && above > below;

    setPosition({
      top: flip ? Math.max(EDGE, rect.top - Math.min(above, 384) - 8) : rect.bottom + 8,
      // Clamped into the viewport rather than anchored blindly to the trigger:
      // this control leads a row that scrolls sideways, so the trigger can sit
      // anywhere, including partly off-screen.
      left: Math.min(Math.max(EDGE, rect.left), window.innerWidth - PANEL_WIDTH - EDGE),
      maxHeight: Math.min(flip ? above : below, 384),
    });
  }, []);

  // Before paint, so the panel never renders at the wrong place for one frame.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => place();
    // `true` captures scrolls of the containers this sits inside, not just the
    // window — the slot sheet scrolls internally.
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, place]);

  const close = useCallback(
    (returnFocus = true) => {
      setOpen(false);
      setNeedle("");
      if (returnFocus) triggerRef.current?.focus();
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    // Capture, so Escape closes this before the sheet it may be sitting inside.
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  const matches = needle.trim()
    ? authors.filter((a) => a.name.toLocaleLowerCase().includes(needle.trim().toLocaleLowerCase()))
    : authors;

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  /** ↑↓ walk the options, Home/End jump. Kept on the panel so the search box
   *  participates: typing then pressing ↓ moves into the results. */
  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    const jump = event.key === "Home" ? 0 : event.key === "End" ? -1 : null;
    if (!step && jump === null) return;
    event.preventDefault();

    const items = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? [])];
    if (items.length === 0) return;
    const from = items.findIndex((item) => item === document.activeElement);
    const to = jump !== null ? (jump === -1 ? items.length - 1 : 0) : from === -1 ? 0 : (from + step + items.length) % items.length;
    items[to]?.focus();
  };

  const chosen = authors.filter((a) => selected.includes(a.id));
  // One name reads better than "1 person" — it is the answer rather than a count
  // of answers. Past one, the names stop fitting and the count is what scans.
  const value = chosen.length === 0 ? null : chosen.length === 1 ? chosen[0].name : tp("common.people-count", chosen.length);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={`flex h-11 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-2xl border px-3.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 ${
          chosen.length > 0
            ? "border-tomato bg-tomato/10 text-tomato"
            : open
              ? "border-tomato/40 bg-surface text-fg"
              : "border-line bg-surface text-muted hover:border-tomato/40 hover:text-fg"
        }`}
      >
        <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {/* The label never disappears. A control that swaps its label for its
            value stops saying what it filters on the moment it is in use, which
            is exactly when a reader needs to be told. */}
        <span className={chosen.length > 0 ? "font-semibold text-tomato/70" : "font-semibold"}>
          {t("common.created-by")}
        </span>
        {value && <span className="max-w-[7.5rem] truncate font-bold">{value}</span>}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            onKeyDown={onPanelKeyDown}
            style={{ top: position.top, left: position.left, width: PANEL_WIDTH, maxHeight: position.maxHeight }}
            className="fixed z-[60] flex flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-paw will-fetch animate-fetch-in"
          >
            {authors.length >= SEARCHABLE_FROM && (
              <div className="relative border-b border-line p-2">
                <Search className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                <input
                  type="search"
                  autoFocus
                  value={needle}
                  onChange={(e) => setNeedle(e.target.value)}
                  aria-label={t("common.search-people")}
                  placeholder={t("common.search-people")}
                  className="h-10 w-full rounded-2xl bg-surface-2 pl-9 pr-3 text-sm text-fg placeholder:text-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                />
              </div>
            )}

            <div
              role="listbox"
              aria-multiselectable
              aria-label={t("common.created-by")}
              className="min-h-0 flex-1 overflow-y-auto p-1.5"
            >
              {matches.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted">{t("common.no-people-match")}</p>
              ) : (
                matches.map((author) => {
                  const on = selected.includes(author.id);
                  return (
                    <button
                      key={author.id}
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => toggle(author.id)}
                      className={`flex h-11 w-full cursor-pointer items-center gap-2.5 rounded-2xl px-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 ${
                        on ? "bg-tomato/10" : "hover:bg-surface-2"
                      }`}
                    >
                      {/* Neutral, not colour-coded: the name is right beside it,
                          so a hue would be decoration competing with the one
                          signal that matters — whether the row is ticked. */}
                      <span
                        aria-hidden
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-[0.65rem] font-bold ${
                          on ? "bg-tomato text-white" : "bg-surface-2 text-muted"
                        }`}
                      >
                        {initialsOf(author.name)}
                      </span>
                      <span className={`min-w-0 flex-1 truncate text-sm ${on ? "font-bold text-tomato" : "font-semibold text-fg"}`}>
                        {author.name}
                      </span>
                      {author.id === currentUserId && (
                        <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-muted">
                          {t("common.you")}
                        </span>
                      )}
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                          on ? "border-tomato bg-tomato text-white" : "border-line"
                        }`}
                        aria-hidden
                      >
                        {on && <Check className="h-3.5 w-3.5" />}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {/* Only when there is something to undo: an always-present footer
                spends a row of a phone screen saying "0 selected". */}
            {chosen.length > 0 && (
              <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2">
                <span className="text-xs font-semibold text-muted">{tp("common.selected-count", chosen.length)}</span>
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="cursor-pointer rounded-full px-2 py-1 text-xs font-bold text-tomato underline-offset-4 transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                >
                  {t("common.clear-all")}
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
