import { HubbaIcon } from "./hubbaIcons";
import { isHubbaIconsEnabled } from "../lib/featureFlags";
/** Inline SVG glyphs used by NotificationBell. Purely presentational. */

const STROKE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function BellGlyph({
  className,
  size,
  strokeWidth = "2",
}: {
  className?: string;
  size: string;
  strokeWidth?: string;
}) {
  // HubbaIcons bell (flagged). The set uses one stroke weight everywhere, so
  // strokeWidth only applies to the legacy glyph.
  if (isHubbaIconsEnabled()) return <HubbaIcon name="bell" size={Number(size)} className={className} />;
  return (
    <svg className={className} width={size} height={size} strokeWidth={strokeWidth} {...STROKE}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export function SoundGlyph({ on }: { on: boolean }) {
  return (
    <svg width="14" height="14" strokeWidth="2" {...STROKE}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      {on ? (
        <>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </>
      ) : (
        <>
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </>
      )}
    </svg>
  );
}
