/**
 * "Hubz" the chill skate buddy. Pure inline SVG so there are no asset
 * dependencies and the mascot scales with rem-based className sizing. Each
 * `state` prop maps to a Tailwind animation class.
 *
 * All decorative subnodes are aria-hidden — the outer <svg> carries the
 * single role="img" + aria-label so screen readers announce one element.
 */

export type HubzState = "idle" | "talking" | "cheer";

interface HubzMascotProps {
  state?: HubzState;
  className?: string;
  /** Render purely decoratively (no aria-label) when paired with adjacent live text. */
  decorative?: boolean;
}

function stateAnimationClass(state: HubzState): string {
  switch (state) {
    case "idle":
      return "motion-safe:animate-float";
    case "talking":
      return "motion-safe:animate-float";
    case "cheer":
      return "motion-safe:animate-ollie";
  }
}

export function HubzMascot({ state = "idle", className, decorative = false }: HubzMascotProps) {
  const animation = stateAnimationClass(state);
  const a11y = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": "Hubz the skate buddy" } as const);

  return (
    <svg
      viewBox="0 0 120 120"
      xmlns="http://www.w3.org/2000/svg"
      className={`${className ?? ""} ${animation}`.trim()}
      data-testid="hubz-mascot"
      data-state={state}
      {...a11y}
    >
      {/* glow ring used by cheer state */}
      {state === "cheer" && (
        <circle
          cx="60"
          cy="58"
          r="44"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-brand-orange motion-safe:animate-glow-pulse"
          opacity="0.4"
          aria-hidden="true"
        />
      )}

      {/* skateboard peeking behind the head */}
      <g aria-hidden="true">
        <rect x="14" y="92" width="92" height="6" rx="3" fill="#1a1a1a" />
        <rect x="14" y="92" width="92" height="2" rx="1" fill="#ff6b00" opacity="0.7" />
        <circle cx="26" cy="102" r="4" fill="#2a2a2a" />
        <circle cx="94" cy="102" r="4" fill="#2a2a2a" />
      </g>

      {/* head */}
      <g aria-hidden="true">
        <circle cx="60" cy="58" r="34" fill="#ffd6a8" stroke="#ff6b00" strokeWidth="2" />

        {/* snapback cap */}
        <path d="M28 46 Q60 22 92 46 L92 52 L28 52 Z" fill="#ff6b00" />
        <rect x="28" y="50" width="64" height="4" fill="#1a1a1a" />
        <path d="M92 52 L106 56 L92 58 Z" fill="#1a1a1a" opacity="0.7" />

        {/* eyes */}
        <circle cx="50" cy="62" r="3" fill="#1a1a1a" />
        <circle cx="70" cy="62" r="3" fill="#1a1a1a" />

        {/* mouth — varies per state */}
        {state === "talking" && (
          <path d="M52 76 Q60 80 68 76" stroke="#1a1a1a" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        )}
        {state === "idle" && (
          <path d="M52 76 Q60 78 68 76" stroke="#1a1a1a" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        )}
        {state === "cheer" && (
          <path
            d="M50 74 Q60 86 70 74"
            stroke="#1a1a1a"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="#ff3d00"
            opacity="0.85"
          />
        )}

        {/* cheek tint for warmth */}
        <circle cx="44" cy="70" r="3" fill="#ff6b00" opacity="0.25" />
        <circle cx="76" cy="70" r="3" fill="#ff6b00" opacity="0.25" />
      </g>
    </svg>
  );
}
