/**
 * Placeholder shapes for /dashboard and /profile.
 *
 * Both pages used to blank to a spinner while waiting on the network, which
 * says "something is happening" but not *what* — and it collapses the layout,
 * so everything jumps when data lands. These mirror the real structures at the
 * real sizes, following DineSkeleton: a skeleton that reserves the wrong height
 * is worse than none, because it moves the page twice.
 *
 * Shimmer comes from .skeleton + animate-sweep and collapses under
 * prefers-reduced-motion via the global rule in globals.css.
 */
function Bar({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton animate-sweep rounded-full ${className}`} style={style} />;
}

/** Matches the header, filter row and list rows on /dashboard. */
export function DashboardSkeleton() {
  return (
    <div aria-hidden>
      {/* Sub-toolbar: the "New recipe" button's row, so the header doesn't shift up */}
      <div className="mb-6 flex items-center justify-end">
        <Bar className="h-10 w-32" />
      </div>

      {/* Page heading + count line */}
      <div className="mb-6">
        <Bar className="h-9 w-64" />
        <Bar className="mt-2.5 h-4 w-44" />
      </div>

      {/* Search box, then the chip row */}
      <Bar className="h-12 w-full rounded-2xl" />
      <div className="mt-3 flex gap-2">
        {[72, 64, 88].map((w) => (
          <Bar key={w} className="h-11" style={{ width: w }} />
        ))}
      </div>

      {/* List rows: plate + two lines, at the real height */}
      <div className="mt-5 space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5">
            <Bar className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <Bar className="h-4 w-2/5" />
              <Bar className="mt-2 h-3 w-1/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Matches the tab strip, hero, stats and two hub cards on /profile's overview. */
export function ProfileSkeleton() {
  return (
    <div aria-hidden className="space-y-5">
      {/* Tab strip — four equal columns, so the tabs don't shift in when data lands */}
      <div className="grid grid-cols-4 gap-1 rounded-full border border-line bg-surface p-1">
        {[0, 1, 2, 3].map((i) => (
          <Bar key={i} className="h-11" />
        ))}
      </div>

      {/* Hero: monogram + two lines of identity */}
      <div className="flex items-center gap-4 rounded-4xl border border-line bg-surface p-6 sm:gap-5 sm:p-7">
        <Bar className="h-16 w-16 shrink-0 rounded-3xl sm:h-20 sm:w-20" />
        <div className="min-w-0 flex-1">
          <Bar className="h-7 w-40" />
          <Bar className="mt-2 h-3.5 w-52" />
          <Bar className="mt-2 h-3 w-36" />
        </div>
      </div>

      {/* Stats strip — three figures */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-3xl border border-line bg-surface px-3 py-4 sm:px-4">
            <Bar className="mx-auto h-4 w-4 rounded-md" />
            <Bar className="mx-auto mt-2 h-7 w-10" />
            <Bar className="mx-auto mt-2 h-2.5 w-14" />
          </div>
        ))}
      </div>

      {/* The two hub cards */}
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-4 rounded-3xl border border-line bg-surface p-5">
            <Bar className="h-11 w-11 shrink-0 rounded-2xl" />
            <div className="min-w-0 flex-1">
              <Bar className="h-4 w-24" />
              <Bar className="mt-2 h-3 w-32" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
