"use client";

import { BookOpen, MessageSquareQuote, Settings, Sparkles } from "lucide-react";
import { PROFILE_TABS, type ProfileTab } from "@/lib/profile-url";

const META: Record<ProfileTab, { label: string; icon: typeof Sparkles }> = {
  overview: { label: "Overview", icon: Sparkles },
  recipes: { label: "Recipes", icon: BookOpen },
  reviews: { label: "Reviews", icon: MessageSquareQuote },
  account: { label: "Account", icon: Settings },
};

/**
 * The profile's section switch.
 *
 * Equal-width columns rather than content-width pills, for one reason that
 * matters more than it looks: with a fixed 25% width the moving indicator only
 * needs `translateX`, so the transition is a composited transform. Animating a
 * measured `width` as well would mean a layout pass per frame and a
 * `ResizeObserver` to stay correct through font loading and translation —
 * a lot of machinery to make four short words look uneven.
 *
 * Rendered as a `tablist` with real `tab` roles so arrow keys and screen
 * readers behave, but each tab also writes the URL, so the browser's own back
 * gesture moves between sections. That is the whole point of the rework.
 *
 * The indicator is `aria-hidden`: `aria-selected` already says which tab is
 * current, and a decorative div claiming to be state is worse than silence.
 */
export function ProfileTabs({
  active,
  counts,
  onSelect,
}: {
  active: ProfileTab;
  /** Shown as a superscript on the two list tabs; omit a key to show no number. */
  counts?: Partial<Record<ProfileTab, number>>;
  onSelect: (tab: ProfileTab) => void;
}) {
  const index = PROFILE_TABS.indexOf(active);

  return (
    <div
      role="tablist"
      aria-label="Profile sections"
      className="relative grid grid-cols-4 rounded-full border border-line bg-surface p-1"
    >
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 rounded-full bg-tomato shadow-pop transition-transform duration-300 ease-[cubic-bezier(.22,.9,.27,1)] motion-reduce:transition-none"
        style={{
          // A grid column is (track - 2×p-1) / 4 = 25% - 0.125rem. Sizing the
          // indicator to exactly that means a step is one of its own widths,
          // so the offset is a plain multiple of 100% and stays correct at
          // every viewport without measuring anything.
          width: "calc(25% - 0.125rem)",
          transform: `translateX(${index * 100}%)`,
        }}
      />

      {PROFILE_TABS.map((tab) => {
        const { label, icon: Icon } = META[tab];
        const on = tab === active;
        const count = counts?.[tab];
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`profile-tab-${tab}`}
            aria-selected={on}
            aria-controls={`profile-panel-${tab}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(tab)}
            onKeyDown={(e) => {
              // Arrow keys move between tabs, as a tablist is expected to.
              const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (!delta) return;
              e.preventDefault();
              const next = PROFILE_TABS[(index + delta + PROFILE_TABS.length) % PROFILE_TABS.length];
              onSelect(next);
              // Focus has to follow the selection: only the active tab is in the
              // tab order (`tabIndex` below), so leaving focus on the old button
              // strands it on an element the next Tab press cannot return to.
              // All four buttons are always mounted, so this resolves now.
              document.getElementById(`profile-tab-${next}`)?.focus();
            }}
            // min-h-11 = 44px. The label stays visible at every width: an
            // icon-only tab makes you learn four glyphs to navigate your own
            // profile.
            className={`relative z-10 flex min-h-11 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-full px-1 font-display text-[0.8rem] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 sm:text-sm ${
              on ? "text-white" : "text-muted hover:text-fg"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
            {count !== undefined && count > 0 && (
              <span
                className={`hidden text-[0.7rem] font-semibold tabular-nums sm:inline ${
                  on ? "text-white/70" : "text-muted/70"
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
