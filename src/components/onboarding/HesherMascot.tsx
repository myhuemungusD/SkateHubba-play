/**
 * "Hesher" the chill skate buddy: the illustrated guide who hosts the
 * onboarding tips. Rendered as a round portrait with the brand-orange ring.
 *
 * Assets live in public/assets/hesher/ as WebP (primary) with a PNG fallback,
 * at 48 / 96 / 144px for 1x / 2x / 3x of the 48px (w-12) bubble slot. All six
 * files together are ~28 KB, so the portrait never holds up the tip.
 *
 * Each `state` prop maps to a Tailwind animation class. The outer element
 * carries the size className and animation; the label lives on the <img>
 * alt so screen readers announce a single element.
 */

export type HesherState = "idle" | "talking" | "cheer";

interface HesherMascotProps {
  state?: HesherState;
  className?: string;
  /** Render purely decoratively (no accessible name) when paired with adjacent live text. */
  decorative?: boolean;
}

export const HESHER_LABEL = "Hesher the skate buddy";

// Versioned name: the service worker treats /assets/ as immutable
// (cache-first), so new art must ship under a new filename.
const BASE = "/assets/hesher/hesher-v1";
const WEBP_SRCSET = `${BASE}-48.webp 1x, ${BASE}-96.webp 2x, ${BASE}-144.webp 3x`;
const PNG_SRCSET = `${BASE}-48.png 1x, ${BASE}-96.png 2x, ${BASE}-144.png 3x`;

function stateAnimationClass(state: HesherState): string {
  switch (state) {
    case "idle":
      return "motion-safe:animate-float";
    case "talking":
      return "motion-safe:animate-float";
    case "cheer":
      return "motion-safe:animate-ollie";
  }
}

export function HesherMascot({ state = "idle", className, decorative = false }: HesherMascotProps) {
  const animation = stateAnimationClass(state);

  return (
    <span
      className={`relative inline-block rounded-full ${className ?? ""} ${animation}`.trim()}
      data-testid="hesher-mascot"
      data-state={state}
      aria-hidden={decorative ? true : undefined}
    >
      {/* glow ring used by cheer state */}
      {state === "cheer" && (
        <span
          aria-hidden="true"
          data-testid="hesher-glow"
          className="absolute -inset-1 rounded-full ring-2 ring-brand-orange opacity-40 motion-safe:animate-glow-pulse"
        />
      )}
      <picture>
        <source type="image/webp" srcSet={WEBP_SRCSET} />
        <img
          src={`${BASE}-48.png`}
          srcSet={PNG_SRCSET}
          width={48}
          height={48}
          alt={decorative ? "" : HESHER_LABEL}
          draggable={false}
          decoding="async"
          className="block w-full h-full rounded-full object-cover bg-surface-alt ring-2 ring-brand-orange select-none"
        />
      </picture>
    </span>
  );
}
