import { SamLogo } from "@/components/brand/SamLogo";

/**
 * Full-screen "fetching" loader: SAM bobs while three dots bounce in the
 * brand colours. Respects prefers-reduced-motion (animations collapse via
 * the global media query in globals.css).
 */
export function Loader({ label = "Fetching…" }: { label?: string }) {
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
        <p className="text-sm font-medium text-muted">{label}</p>
      </div>
    </div>
  );
}

/** Inline spinner-sized version for buttons / small areas. */
export function FetchDots({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ""}`} aria-hidden="true">
      <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce-dot" />
      <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce-dot" style={{ animationDelay: "0.15s" }} />
      <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce-dot" style={{ animationDelay: "0.3s" }} />
    </span>
  );
}
