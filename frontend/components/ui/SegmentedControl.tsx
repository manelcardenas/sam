"use client";

import type { LucideIcon } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";

/**
 * A row of mutually exclusive options in a pill: Plan's week/list switch, the
 * profile sections.
 *
 * **On a phone only the selected segment spells its label; the rest show
 * their icon** (with the label as accessible name and tooltip). From `sm` up
 * every segment shows both. Five Catalan labels in 328 px came out as
 * "Recept… Resse… Setma…", and two of them pushed /plan sideways off the
 * screen; a cut label tells you less than a whole icon, and the selected one
 * still says where you are. Labels never wrap or truncate.
 *
 * `role="tablist"` gives tab semantics and arrow-key movement, for segments
 * that switch a panel in place; the default marks the selection with
 * `aria-current`, for segments that act as navigation.
 */

export type Segment<T extends string> = {
  value: T;
  label: string;
  icon: LucideIcon;
  /** A small number after the label, e.g. items left on a list. Shown even while collapsed. */
  badge?: number;
  /** For `role="tablist"`: the panel this tab controls. */
  controls?: string;
};

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  label,
  role,
  idPrefix,
  stretch = false,
}: {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the whole group. */
  label: string;
  role?: "tablist";
  /** Prefix for each segment's id; needed with `role="tablist"` so panels can point back. */
  idPrefix?: string;
  /** Span the container, spreading the segments out, instead of hugging them. */
  stretch?: boolean;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const tabs = role === "tablist";

  const onKeyDown = (event: KeyboardEvent) => {
    if (!tabs) return;
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const index = segments.findIndex((s) => s.value === value);
    const next = segments[(index + delta + segments.length) % segments.length].value;
    onChange(next);
    // Only the selected tab is in the tab order, so focus has to follow it.
    refs.current.get(next)?.focus();
  };

  return (
    <div
      role={tabs ? "tablist" : "group"}
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`max-w-full items-center gap-0.5 rounded-full border border-line bg-surface p-1 ${stretch ? "flex w-full justify-between" : "inline-flex"}`}
    >
      {segments.map((segment) => {
        const on = segment.value === value;
        const Icon = segment.icon;
        return (
          <button
            key={segment.value}
            ref={(el) => {
              if (el) refs.current.set(segment.value, el);
              else refs.current.delete(segment.value);
            }}
            type="button"
            onClick={() => onChange(segment.value)}
            id={idPrefix ? `${idPrefix}-${segment.value}` : undefined}
            {...(tabs
              ? { role: "tab", "aria-selected": on, "aria-controls": segment.controls, tabIndex: on ? 0 : -1 }
              : { "aria-current": on ? ("page" as const) : undefined })}
            // sr-only keeps the label as the accessible name while it is hidden.
            title={segment.label}
            className={`flex min-h-10 min-w-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-display text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 ${
              on ? "bg-tomato px-3.5 text-white shadow-pop" : "px-2.5 text-muted hover:text-fg sm:px-3.5"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className={on ? "" : "sr-only sm:not-sr-only"}>{segment.label}</span>
            {segment.badge !== undefined && segment.badge > 0 && (
              <span className="tabular-nums opacity-70">{segment.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
