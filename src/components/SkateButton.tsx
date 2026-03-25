import { useState, useId, type ReactNode } from "react";
import { playOlliePop } from "../utils/ollieSound";

/**
 * A skateboard-shaped button that does an ollie animation on click.
 * The deck is the button surface; wheels spin on hover and the whole
 * board pops up on click.
 */
export function SkateButton({
  children,
  onClick,
  disabled,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [popping, setPopping] = useState(false);
  const uid = useId().replace(/:/g, "");

  const handleClick = () => {
    if (disabled) return;
    setPopping(true);
    playOlliePop();
    setTimeout(() => setPopping(false), 500);
    onClick?.();
  };

  const gradId = `deckGrad-${uid}`;
  const strokeId = `deckStroke-${uid}`;
  const shineId = `deckShine-${uid}`;
  const innerGlowId = `innerGlow-${uid}`;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`group relative w-full disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-orange ${className}`}
    >
      <div
        className={`relative transition-all duration-300 ease-smooth ${popping ? "animate-ollie" : ""} group-hover:-translate-y-0.5 group-hover:drop-shadow-[0_8px_24px_rgba(255,107,0,0.2)] group-active:translate-y-0`}
      >
        <svg
          viewBox="0 0 320 72"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-auto"
          aria-hidden="true"
        >
          {/* Drop shadow filter */}
          <defs>
            <filter id={`shadow-${uid}`} x="-10%" y="-10%" width="120%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.3" />
            </filter>

            <linearGradient id={gradId} x1="0" y1="0" x2="320" y2="72" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#E85D00" />
              <stop offset="30%" stopColor="#FF6B00" />
              <stop offset="60%" stopColor="#FF7A1A" />
              <stop offset="100%" stopColor="#E85D00" />
            </linearGradient>

            <linearGradient id={strokeId} x1="0" y1="0" x2="320" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#B34700" />
              <stop offset="50%" stopColor="#FF8533" />
              <stop offset="100%" stopColor="#B34700" />
            </linearGradient>

            <linearGradient id={shineId} x1="160" y1="10" x2="160" y2="36" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="white" stopOpacity="0.35" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </linearGradient>

            <radialGradient id={innerGlowId} cx="50%" cy="30%" r="60%">
              <stop offset="0%" stopColor="#FFB366" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#FF6B00" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Deck shape — kicked nose and tail */}
          <g filter={`url(#shadow-${uid})`}>
            <path
              d="M28 8 C12 8, 4 18, 6 28 L8 44 C10 52, 18 56, 28 56 L292 56 C302 56, 310 52, 312 44 L314 28 C316 18, 308 8, 292 8 Z"
              fill={`url(#${gradId})`}
              stroke={`url(#${strokeId})`}
              strokeWidth="1.5"
            />
          </g>

          {/* Grip tape */}
          <rect x="32" y="12" width="256" height="40" rx="8" fill="#1a1a1a" opacity="0.65" />

          {/* Inner glow for depth */}
          <rect x="32" y="12" width="256" height="40" rx="8" fill={`url(#${innerGlowId})`} />

          {/* Top shine highlight */}
          <rect x="32" y="12" width="256" height="20" rx="8" fill={`url(#${shineId})`} />

          {/* Front truck */}
          <rect x="54" y="56" width="44" height="4" rx="2" fill="#777" />
          {/* Rear truck */}
          <rect x="222" y="56" width="44" height="4" rx="2" fill="#777" />
        </svg>

        {/* Text overlay on the deck */}
        <span className="absolute inset-0 flex items-center justify-center font-display text-xl tracking-wider text-white pb-2 select-none drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)] [text-shadow:0_0_20px_rgba(255,107,0,0.3)]">
          {children}
        </span>
      </div>
    </button>
  );
}
