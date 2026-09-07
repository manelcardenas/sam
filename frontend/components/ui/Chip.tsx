/**
 * A filter pill.
 *
 * Extracted from `components/dine/RestaurantFilters.tsx`, which had it as a
 * local component, so the profile's lists narrow with the same affordance
 * rather than a lookalike. `/dashboard` is the third caller
 * (docs/plans/ux-refresh-plan.md §2).
 *
 * `rounded-full` is load-bearing: the app uses fully-round pills for things
 * that toggle and rounded rectangles for things that hold a value, which is
 * what tells a chip apart from the search input and the sort control at a
 * glance.
 */
export function Chip({
  active,
  onClick,
  children,
  label,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** Use when the visible content isn't readable text, e.g. a run of € glyphs. */
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      // h-11 = 44px: the minimum comfortable touch target.
      className={`flex h-11 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 ${
        active
          ? "border-tomato bg-tomato text-white shadow-pop"
          : "border-line bg-surface text-muted hover:border-tomato/40 hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

/** The "stop narrowing" affordance that sits at the end of a chip row. */
export function ClearChip({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-semibold text-muted underline-offset-4 transition-colors hover:text-tomato hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
    >
      <XIcon />
      Clear
    </button>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" aria-hidden>
      <path
        d="M18 6 6 18M6 6l12 12"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
