import { SamLogo } from "@/components/brand/SamLogo";

/**
 * Full-screen loader: SAM bobs while three dots bounce in the brand colours.
 * Respects prefers-reduced-motion (animations collapse via the global media
 * query in globals.css).
 *
 * **`label` is optional and usually omitted.** It used to default to
 * "Fetching…" and callers passed things like "Sniffing around…" — but a loader
 * is the most-repeated screen in the app, and character costs are paid per
 * viewing (docs/plans/ux-refresh-plan.md §3). The bobbing mascot already says
 * who is talking and the dots already say "wait", so a word adds nothing. It
 * stays available for the rare loader that has something unexpected to explain.
 */
export function Loader({ label }: { label?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg bg-paws">
      <div className="flex flex-col items-center gap-5">
        <SamLogo className="h-16 w-16 animate-float" />
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-tomato animate-bounce-dot" />
          <span
            className="h-2.5 w-2.5 rounded-full bg-amber animate-bounce-dot"
            style={{ animationDelay: "0.15s" }}
          />
          <span
            className="h-2.5 w-2.5 rounded-full bg-ink dark:bg-cream animate-bounce-dot"
            style={{ animationDelay: "0.3s" }}
          />
        </div>
        {label && <p className="text-sm font-medium text-muted">{label}</p>}
      </div>
    </div>
  );
}
