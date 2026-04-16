import { useState, useEffect, useRef, useId, type ReactNode } from "react";
import { playOlliePop } from "../utils/ollieSound";

/**
 * A skateboard deck-shaped button that does an ollie animation on click.
 * Realistic top-down popsicle deck with grip tape, maple rails,
 * and hardware bolts. Deck only — no trucks or wheels.
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
  const popTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (popTimerRef.current) clearTimeout(popTimerRef.current);
    };
  }, []);

  const handleClick = () => {
    if (disabled) return;
    setPopping(true);
    playOlliePop();
    if (popTimerRef.current) clearTimeout(popTimerRef.current);
    popTimerRef.current = setTimeout(() => setPopping(false), 500);
    onClick?.();
  };

  const gripId = `grip-${uid}`;
  const woodId = `wood-${uid}`;
  const boltId = `bolt-${uid}`;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`group relative w-full disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-orange ${className}`}
    >
      <div
        className={`relative transition-all duration-300 ease-smooth ${popping ? "animate-ollie" : ""} group-hover:-translate-y-0.5 group-hover:drop-shadow-[0_8px_24px_rgba(0,0,0,0.4)] group-active:translate-y-0`}
      >
        <svg
          viewBox="0 0 340 58"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-auto"
          aria-hidden="true"
        >
          <defs>
            {/* Drop shadow */}
            <filter id={`shadow-${uid}`} x="-8%" y="-10%" width="116%" height="130%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.35" />
            </filter>

            {/* Maple wood gradient */}
            <linearGradient id={woodId} x1="0" y1="0" x2="340" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#C4863C" />
              <stop offset="15%" stopColor="#D4964A" />
              <stop offset="50%" stopColor="#DBA055" />
              <stop offset="85%" stopColor="#D4964A" />
              <stop offset="100%" stopColor="#C4863C" />
            </linearGradient>

            {/* Grip tape texture */}
            <pattern id={gripId} patternUnits="userSpaceOnUse" width="3" height="3">
              <rect width="3" height="3" fill="#111" />
              <rect x="0" y="0" width="1" height="1" fill="#1a1a1a" opacity="0.5" />
              <rect x="2" y="1" width="1" height="1" fill="#0a0a0a" opacity="0.3" />
              <rect x="1" y="2" width="1" height="1" fill="#1a1a1a" opacity="0.4" />
            </pattern>

            {/* Bolt gradient */}
            <radialGradient id={boltId} cx="40%" cy="40%" r="50%">
              <stop offset="0%" stopColor="#555" />
              <stop offset="100%" stopColor="#333" />
            </radialGradient>
          </defs>

          <g filter={`url(#shadow-${uid})`}>
            {/* Deck — popsicle shape, maple wood rails */}
            <path
              d="M30 4 C18 4, 8 12, 6 22 L6 34 C8 44, 18 52, 30 52 L310 52 C322 52, 332 44, 334 34 L334 22 C332 12, 322 4, 310 4 Z"
              fill={`url(#${woodId})`}
            />

            {/* Wood ply lines on nose/tail */}
            <path
              d="M30 4 C18 4, 8 12, 6 22 L6 34 C8 44, 18 52, 30 52"
              fill="none"
              stroke="#A06828"
              strokeWidth="0.5"
              opacity="0.6"
            />
            <path
              d="M310 4 C322 4, 332 12, 334 22 L334 34 C332 44, 322 52, 310 52"
              fill="none"
              stroke="#A06828"
              strokeWidth="0.5"
              opacity="0.6"
            />

            {/* Grip tape — inset from edges */}
            <path
              d="M32 6 C20 6, 11 13, 9 22 L9 34 C11 43, 20 50, 32 50 L308 50 C320 50, 329 43, 331 34 L331 22 C329 13, 320 6, 308 6 Z"
              fill={`url(#${gripId})`}
            />

            {/* Grip tape edge */}
            <path
              d="M32 6 C20 6, 11 13, 9 22 L9 34 C11 43, 20 50, 32 50 L308 50 C320 50, 329 43, 331 34 L331 22 C329 13, 320 6, 308 6 Z"
              fill="none"
              stroke="#333"
              strokeWidth="0.5"
              opacity="0.4"
            />

            {/* Front hardware bolts */}
            <circle cx="62" cy="20" r="2" fill={`url(#${boltId})`} />
            <circle cx="62" cy="36" r="2" fill={`url(#${boltId})`} />
            <circle cx="74" cy="20" r="2" fill={`url(#${boltId})`} />
            <circle cx="74" cy="36" r="2" fill={`url(#${boltId})`} />
            <line x1="60" y1="20" x2="64" y2="20" stroke="#222" strokeWidth="0.6" />
            <line x1="62" y1="18" x2="62" y2="22" stroke="#222" strokeWidth="0.6" />
            <line x1="60" y1="36" x2="64" y2="36" stroke="#222" strokeWidth="0.6" />
            <line x1="62" y1="34" x2="62" y2="38" stroke="#222" strokeWidth="0.6" />
            <line x1="72" y1="20" x2="76" y2="20" stroke="#222" strokeWidth="0.6" />
            <line x1="74" y1="18" x2="74" y2="22" stroke="#222" strokeWidth="0.6" />
            <line x1="72" y1="36" x2="76" y2="36" stroke="#222" strokeWidth="0.6" />
            <line x1="74" y1="34" x2="74" y2="38" stroke="#222" strokeWidth="0.6" />

            {/* Rear hardware bolts */}
            <circle cx="266" cy="20" r="2" fill={`url(#${boltId})`} />
            <circle cx="266" cy="36" r="2" fill={`url(#${boltId})`} />
            <circle cx="278" cy="20" r="2" fill={`url(#${boltId})`} />
            <circle cx="278" cy="36" r="2" fill={`url(#${boltId})`} />
            <line x1="264" y1="20" x2="268" y2="20" stroke="#222" strokeWidth="0.6" />
            <line x1="266" y1="18" x2="266" y2="22" stroke="#222" strokeWidth="0.6" />
            <line x1="264" y1="36" x2="268" y2="36" stroke="#222" strokeWidth="0.6" />
            <line x1="266" y1="34" x2="266" y2="38" stroke="#222" strokeWidth="0.6" />
            <line x1="276" y1="20" x2="280" y2="20" stroke="#222" strokeWidth="0.6" />
            <line x1="278" y1="18" x2="278" y2="22" stroke="#222" strokeWidth="0.6" />
            <line x1="276" y1="36" x2="280" y2="36" stroke="#222" strokeWidth="0.6" />
            <line x1="278" y1="34" x2="278" y2="38" stroke="#222" strokeWidth="0.6" />
          </g>
        </svg>

        {/* Text overlay on the grip tape */}
        <span className="absolute inset-0 flex items-center justify-center font-display text-xl tracking-wider text-white select-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)] [text-shadow:0_0_12px_rgba(255,107,0,0.25)]">
          {children}
        </span>
      </div>
    </button>
  );
}
