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
  /** A small number, e.g. items left on a list: on the icon's corner on a phone, after the label from `sm` up. */
  badge?: number;
  /** For `role="tablist"`: the panel this tab controls. */
  controls?: string;
};

/**
 * Classes per breakpoint at which every segment starts spelling its label.
 * Written out whole so Tailwind sees them; a template like `${bp}:inline` would
 * never be generated.
 */
const EXPANDED_FROM = {
  sm: { label: "sr-only sm:not-sr-only", idle: "sm:min-w-10 sm:px-3.5", corner: "sm:hidden", inline: "hidden sm:inline" },
  md: { label: "sr-only md:not-sr-only", idle: "md:min-w-10 md:px-3.5", corner: "md:hidden", inline: "hidden md:inline" },
} as const;

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  label,
  role,
  idPrefix,
  stretch = false,
  labelsFrom = "sm",
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
  /** Where every segment starts showing its label. `md` for a row too long to spell out on a small tablet (the admin's six profile tabs). */
  labelsFrom?: keyof typeof EXPANDED_FROM;
}) {
  const at = EXPANDED_FROM[labelsFrom];
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
        const hasBadge = segment.badge !== undefined && segment.badge > 0;
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
            className={`flex min-h-10 min-w-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-display text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
              on ? "min-w-10 bg-accent px-3.5 text-white shadow-pop" : `px-2 text-muted hover:text-fg ${at.idle}`
            }`}
          >
            <span className="relative flex shrink-0">
              <Icon className="h-4 w-4" aria-hidden />
              {/* On a phone the number sits on the icon's corner instead of beside it,
                  so it adds no width: beside it, two 2-digit counts pushed the sixth
                  profile tab out of the pill at 360 px. */}
              {hasBadge && (
                <span className={`absolute -right-2.5 -top-2 min-w-4 rounded-full bg-surface-2 px-1 text-center text-[10px] leading-4 tabular-nums text-fg ring-1 ring-surface ${at.corner}`}>
                  {segment.badge}
                </span>
              )}
            </span>
            <span className={on ? "" : at.label}>{segment.label}</span>
            {hasBadge && <span className={`tabular-nums opacity-70 ${at.inline}`}>{segment.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
