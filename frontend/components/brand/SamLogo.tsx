import type { SVGProps } from "react";

/**
 * SAM — a stylised border collie head, the brand mascot.
 * Black-and-white coat with the classic eye mask + white blaze. Built from
 * primitives so it stays crisp from favicon size up to hero size.
 */
export function SamLogo({
  className,
  title = "SAM the border collie",
  ...props
}: SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <title>{title}</title>
      {/* Ears (behind head) */}
      <path d="M16 15 C 9 18, 8 31, 15 37 C 19 31, 21 23, 22 18 C 20 16, 18 15, 16 15 Z" fill="#1A1A1A" />
      <path d="M48 15 C 55 18, 56 31, 49 37 C 45 31, 43 23, 42 18 C 44 16, 46 15, 48 15 Z" fill="#1A1A1A" />
      {/* Head */}
      <ellipse cx="32" cy="33" rx="20" ry="19" fill="#FFFFFF" stroke="#1A1A1A" strokeWidth="2" />
      {/* Black mask patches — leave a white blaze down the centre */}
      <path d="M32 13 C 22 12, 14 18, 15 30 C 16 37, 24 36, 28 30 C 31 25, 32 19, 32 13 Z" fill="#1A1A1A" />
      <path d="M32 13 C 42 12, 50 18, 49 30 C 48 37, 40 36, 36 30 C 33 25, 32 19, 32 13 Z" fill="#1A1A1A" />
      {/* Eyes — matched dark eyes */}
      <circle cx="23" cy="28" r="4" fill="#FFFFFF" />
      <circle cx="23" cy="28" r="2.4" fill="#1A1A1A" />
      <circle cx="24" cy="27" r="0.9" fill="#FFFFFF" />
      <circle cx="41" cy="28" r="4" fill="#FFFFFF" />
      <circle cx="41" cy="28" r="2.4" fill="#1A1A1A" />
      <circle cx="42" cy="27" r="0.9" fill="#FFFFFF" />
      {/* Muzzle */}
      <path d="M27 41 Q32 45 37 41" fill="none" stroke="#1A1A1A" strokeWidth="1.6" strokeLinecap="round" />
      <ellipse cx="32" cy="38.5" rx="3.2" ry="2.4" fill="#1A1A1A" />
      {/* Tongue */}
      <path d="M30 43 Q32 48 34 43 Z" fill="#E4572E" />
    </svg>
  );
}
