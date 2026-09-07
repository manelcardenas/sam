/**
 * Placeholder shapes for the dine list.
 *
 * Sized to match the real rail and cards so the layout doesn't jump when data
 * lands — a skeleton that reserves the wrong height is worse than none, because
 * it moves everything twice. The shimmer comes from .skeleton + animate-sweep,
 * and collapses under prefers-reduced-motion via the global rule in globals.css.
 */
function Bar({ className = "" }: { className?: string }) {
  return <div className={`skeleton animate-sweep rounded-full ${className}`} />;
}

export function DineSkeleton() {
  return (
    <div aria-hidden>
      {/* The page heading, as a shape rather than the real text. Rendering the
          real <h1> here would put translated copy into the statically exported
          HTML, which is always English — so a Spanish or Catalan reader saw it
          flash English before hydration corrected it. */}
      <div className="mb-7">
        <Bar className="h-10 w-72 max-w-full sm:h-12" />
      </div>
      {/* Rail */}
      <div className="mb-8">
        <Bar className="mb-2 h-7 w-28" />
        <Bar className="mb-3 h-4 w-52" />
        <div className="-mx-4 flex gap-4 overflow-hidden px-4 sm:mx-0 sm:px-0">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-52 w-[16.5rem] shrink-0 rounded-3xl border border-line bg-surface p-4 sm:w-[18rem]"
            >
              <div className="flex gap-3">
                <Bar className="h-14 w-14 rounded-2xl" />
                <div className="flex-1 space-y-2 pt-1">
                  <Bar className="h-4 w-full" />
                  <Bar className="h-3 w-2/3" />
                </div>
              </div>
              <div className="mt-5 space-y-2">
                <Bar className="h-3.5 w-full" />
                <Bar className="h-3.5 w-5/6" />
                <Bar className="h-3.5 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <Bar className="mb-3 h-12 w-full rounded-2xl" />
      {/* Full-bleed and clipped, exactly like the rail above and like the real
          chip row in RestaurantFilters. These bars are shrink-0 and total 456px,
          so without this they push the *document* ~80px wider than a phone
          viewport. That overflow is what Chrome Android sizes the page scale and
          the fixed tab bar's containing block from — so the footer ends up laid
          out at 473px while the content sits at 393px, i.e. visibly out of sync,
          and the scale never recovers once data replaces the skeleton. */}
      <div className="-mx-4 mb-5 flex gap-2 overflow-hidden px-4 sm:mx-0 sm:px-0">
        {["w-36", "w-24", "w-28", "w-20"].map((w) => (
          <Bar key={w} className={`h-11 shrink-0 ${w}`} />
        ))}
      </div>

      {/* Grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-3xl border border-line bg-surface p-5">
            <div className="flex gap-3">
              <div className="flex-1 space-y-2">
                <Bar className="h-4 w-3/4" />
                <Bar className="h-3 w-1/2" />
              </div>
              <Bar className="h-11 w-11 rounded-2xl" />
            </div>
            <div className="mt-5 space-y-2">
              <Bar className="h-3.5 w-full" />
              <Bar className="h-3.5 w-4/5" />
            </div>
            <div className="mt-5 border-t border-line pt-3">
              <Bar className="h-3 w-2/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
