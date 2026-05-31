import type { SVGProps } from "react";

/** A single paw print — pad + four toes. Inherits color via currentColor. */
export function PawPrint({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <ellipse cx="12" cy="16" rx="5.5" ry="4.5" />
      <ellipse cx="6.5" cy="9" rx="2.1" ry="2.6" />
      <ellipse cx="10.6" cy="6" rx="2.1" ry="2.7" />
      <ellipse cx="14.4" cy="6" rx="2.1" ry="2.7" />
      <ellipse cx="17.6" cy="9" rx="2.1" ry="2.6" />
    </svg>
  );
}
