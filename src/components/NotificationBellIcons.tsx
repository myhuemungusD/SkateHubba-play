import { HubbaIcon } from "./hubbaIcons";
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
  // HubbaIcons bell. strokeWidth is kept on the API for callers but the set
  // uses one stroke weight everywhere for consistency.
  void strokeWidth;
  return <HubbaIcon name="bell" size={Number(size)} className={className} />;
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
