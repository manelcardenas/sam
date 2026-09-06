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
function Bar({ className = "" }: { className?: string }) {
  return <div className={`skeleton animate-sweep rounded-full ${className}`} />;
}

/** Matches the four-tile category grid on /dashboard. */
export function DashboardSkeleton() {
  return (
    <div aria-hidden>
      {/* Sub-toolbar: the "New recipe" button's row, so the grid doesn't shift up */}
      <div className="mb-6 flex items-center justify-end">
        <Bar className="h-10 w-32" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-3xl border border-line bg-surface p-5">
            <Bar className="h-9 w-9 rounded-2xl" />
            <Bar className="mt-4 h-5 w-3/4" />
            <Bar className="mt-2 h-3.5 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Matches the stats strip, account card and two list sections on /profile. */
export function ProfileSkeleton() {
  return (
    <div aria-hidden className="space-y-8">
      {/* Stats strip — three figures, then the wide fourth beneath */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-3xl border border-line bg-surface px-3 py-4 sm:px-4">
            <Bar className="mx-auto h-4 w-4 rounded-md" />
            <Bar className="mx-auto mt-2 h-7 w-10" />
            <Bar className="mx-auto mt-2 h-2.5 w-14" />
          </div>
        ))}
      </div>

      {/* Account editor */}
      <div className="rounded-4xl border border-line bg-surface p-6">
        <Bar className="h-5 w-24" />
        <Bar className="mt-2 h-3.5 w-2/3" />
        <div className="mt-5 space-y-4">
          <div>
            <Bar className="mb-1.5 h-3.5 w-14" />
            <Bar className="h-12 w-full rounded-2xl" />
          </div>
          <div>
            <Bar className="mb-1.5 h-3.5 w-24" />
            <Bar className="h-12 w-full rounded-2xl" />
          </div>
        </div>
      </div>

      {/* Recipes, then reviews */}
      {[0, 1].map((section) => (
        <div key={section}>
          <Bar className="mb-4 h-5 w-40" />
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="rounded-3xl border border-line bg-surface p-5">
                <Bar className="h-4 w-2/3" />
                <Bar className="mt-2.5 h-3.5 w-1/3" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
