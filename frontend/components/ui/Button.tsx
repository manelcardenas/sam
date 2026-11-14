import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * The button. Every clickable action that is not a link goes through this or
 * `IconButton`, so how a label behaves when space runs out is decided once.
 *
 * The rules, because Catalan runs ~19 % longer than English for short labels
 * and the app is used on 360 px phones (e2e/copy-fits.e2e.ts checks them):
 *
 * - **A label never breaks inside a word.** No `overflow-wrap: anywhere`, no
 *   `break-all`: "Guarni / ció" reads as a bug. When space runs out it wraps
 *   between words, balanced.
 * - **A label is never cut** (`truncate`). A half word with an ellipsis hides
 *   what the button does. Where there is no room for a word, use `IconButton`
 *   — an icon and an accessible name — instead of a shortened label.
 * - **The icon never shrinks**, so a squeezed button keeps its glyph.
 *
 * Layout is the caller's: where two actions share a row, `FormActions` stacks
 * them on a phone so each label gets the full width.
 */

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "sm";

const BASE =
  "inline-flex min-w-0 cursor-pointer items-center justify-center gap-2 rounded-full font-display font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white shadow-pop hover:bg-accent-700 active:scale-95",
  secondary: "border border-line bg-surface text-fg hover:border-accent/40 hover:text-accent",
  ghost: "text-muted hover:bg-surface-2 hover:text-fg",
};

const SIZES: Record<Size, string> = {
  // min-h-11 = 44px, the smallest comfortable touch target.
  md: "min-h-11 px-5 py-2.5",
  sm: "min-h-9 px-3.5 py-1.5 text-sm",
};

const ICON_SIZES: Record<Size, string> = { md: "h-4 w-4", sm: "h-3.5 w-3.5" };

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  /** Fill the row. */
  block?: boolean;
  children: ReactNode;
};

export function Button({ variant = "primary", size = "md", icon: Icon, block = false, className = "", type = "button", children, ...rest }: ButtonProps) {
  return (
    <button type={type} className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${block ? "w-full" : ""} ${className}`} {...rest}>
      {Icon && <Icon className={`${ICON_SIZES[size]} shrink-0`} aria-hidden />}
      <span className="text-balance text-center [overflow-wrap:normal] [word-break:normal]">{children}</span>
    </button>
  );
}

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: LucideIcon;
  /** What the button does. Required: it is the only name a screen reader and a tooltip get. */
  label: string;
  variant?: Variant;
  size?: Size;
};

/** An action shown as its icon alone, for where a word does not fit. */
export function IconButton({ icon: Icon, label, variant = "ghost", size = "md", className = "", type = "button", ...rest }: IconButtonProps) {
  const box = size === "md" ? "h-11 w-11" : "h-9 w-9";
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`${BASE} ${VARIANTS[variant]} ${box} shrink-0 p-0 ${className}`}
      {...rest}
    >
      <Icon className={size === "md" ? "h-5 w-5" : "h-4 w-4"} aria-hidden />
    </button>
  );
}

/**
 * A button that is its icon alone on a phone and spells its label from `sm`.
 *
 * For a page's main action beside its title ("+ New recipe" next to "What
 * shall we cook?"): on a 360 px phone the two do not share a line in Catalan or
 * Spanish, and a button on its own row above the title cost ~90 px of the first
 * screen. The label is the accessible name and tooltip everywhere.
 */
export function CompactButton({ label, size = "md", className = "", ...rest }: Omit<ButtonProps, "children" | "icon"> & { icon: LucideIcon; label: string }) {
  // max-sm:gap-0: the label's (now empty) wrapper is still a flex item, and the
  // gap beside it would push the icon off centre.
  const square = size === "sm" ? "max-sm:w-9" : "max-sm:w-11";
  return (
    <Button title={label} size={size} className={`${square} max-sm:gap-0 max-sm:px-0 ${className}`} {...rest}>
      <span className="sr-only sm:not-sr-only">{label}</span>
    </Button>
  );
}

/**
 * The actions at the foot of a form: primary first, then the rest.
 *
 * Stacked full-width on a phone, side by side from `sm` with the primary
 * taking the spare room. Two buttons sharing 280 px is what made "Publica la
 * ressenya" wrap onto two lines; stacked, each label has the whole row.
 */
export function FormActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 pt-2 *:w-full sm:flex-row sm:*:w-auto sm:*:first:flex-1">{children}</div>;
}
