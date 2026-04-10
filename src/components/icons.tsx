import type { ReactNode } from "react";

export interface IconProps {
  size?: number;
  className?: string;
}

/* ── Shared SVG wrapper ─────────────────────────────────── */

function SvgIcon({
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

export function TargetIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
    </SvgIcon>
  );
}

export function FilmIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
      <line x1="7" y1="2" x2="7" y2="22" />
      <line x1="17" y1="2" x2="17" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="2" y1="7" x2="7" y2="7" />
      <line x1="2" y1="17" x2="7" y2="17" />
      <line x1="17" y1="7" x2="22" y2="7" />
      <line x1="17" y1="17" x2="22" y2="17" />
    </SvgIcon>
  );
}

export function VideoIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </SvgIcon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </SvgIcon>
  );
}

export function HourglassIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M5 3h14" />
      <path d="M5 21h14" />
      <path d="M7 3v4.5L12 12l5-4.5V3" />
      <path d="M7 21v-4.5L12 12l5 4.5V21" />
    </SvgIcon>
  );
}

export function XCircleIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </SvgIcon>
  );
}

export function SkullIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="10" r="8" />
      <path d="M12 18v4" />
      <path d="M8 22h8" />
      <circle cx="9" cy="10" r="1.5" fill="currentColor" />
      <circle cx="15" cy="10" r="1.5" fill="currentColor" />
      <path d="M10 15h4" />
      <line x1="11" y1="15" x2="11" y2="17" />
      <line x1="13" y1="15" x2="13" y2="17" />
    </SvgIcon>
  );
}

export function FlameIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </SvgIcon>
  );
}

export function TrophyIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </SvgIcon>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </SvgIcon>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </SvgIcon>
  );
}

export function SkateboardIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="2" y="10" width="20" height="4" rx="2" />
      <circle cx="6.5" cy="17" r="2" />
      <circle cx="17.5" cy="17" r="2" />
      <line x1="6.5" y1="14" x2="6.5" y2="15" />
      <line x1="17.5" y1="14" x2="17.5" y2="15" />
    </SvgIcon>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </SvgIcon>
  );
}

export function RecordIcon(props: IconProps) {
  return (
    <SvgIcon {...props} fill="currentColor" stroke="none">
      <circle cx="12" cy="12" r="8" />
    </SvgIcon>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <SvgIcon {...props} fill="currentColor" stroke="none">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </SvgIcon>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <SvgIcon {...props} fill="currentColor" stroke="none">
      <polygon points="5 3 19 12 5 21 5 3" />
    </SvgIcon>
  );
}

export function ReplayIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </SvgIcon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <polyline points="9 18 15 12 9 6" />
    </SvgIcon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <polyline points="15 18 9 12 15 6" />
    </SvgIcon>
  );
}

export function FisheyeIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="10" />
      <ellipse cx="12" cy="12" rx="10" ry="6" />
      <line x1="12" y1="2" x2="12" y2="22" />
    </SvgIcon>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
    </SvgIcon>
  );
}

export function MapPinIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 22s7-7.58 7-13a7 7 0 0 0-14 0c0 5.42 7 13 7 13z" />
      <circle cx="12" cy="9" r="2.5" />
    </SvgIcon>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </SvgIcon>
  );
}
