import type { ReactNode } from "react";

export interface IconProps {
  size?: number;
  className?: string;
}

/* ── Shared SVG wrapper ─────────────────────────────────── */

export function SvgIcon({
  size = 20,
  className,
  fill = "none",
  stroke = "currentColor",
  children,
}: IconProps & { fill?: string; stroke?: string; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/* ── Icons ──────────────────────────────────────────────── */
