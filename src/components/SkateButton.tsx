import { useState, useId, type ReactNode } from "react";
import { playOlliePop } from "../utils/ollieSound";

/**
 * A skateboard-shaped button that does an ollie animation on click.
 * Realistic top-down popsicle deck with grip tape, maple rails,
 * hardware bolts, metal trucks, and urethane wheels.
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

  const gripId = `grip-${uid}`;
  const woodId = `wood-${uid}`;
  const woodEdgeId = `woodEdge-${uid}`;
  const truckId = `truck-${uid}`;
  const wheelId = `wheel-${uid}`;
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
          viewBox="0 0 340 80"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-auto"
          aria-hidden="true"
        >
          <defs>
            {/* Drop shadow */}
            <filter id={`shadow-${uid}`} x="-8%" y="-8%" width="116%" height="140%">
              <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#000" floodOpacity="0.4" />
            </filter>

            {/* Maple wood gradient — natural Canadian maple */}
            <linearGradient id={woodId} x1="0" y1="0" x2="340" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#C4863C" />
              <stop offset="15%" stopColor="#D4964A" />
              <stop offset="50%" stopColor="#DBA055" />
              <stop offset="85%" stopColor="#D4964A" />
              <stop offset="100%" stopColor="#C4863C" />
            </linearGradient>

            {/* Wood edge — slightly darker for rail shadow */}
            <linearGradient id={woodEdgeId} x1="170" y1="4" x2="170" y2="56" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#B8783A" />
              <stop offset="50%" stopColor="#A86830" />
              <stop offset="100%" stopColor="#B8783A" />
            </linearGradient>

            {/* Grip tape texture pattern */}
            <pattern id={gripId} patternUnits="userSpaceOnUse" width="3" height="3">
              <rect width="3" height="3" fill="#111" />
              <rect x="0" y="0" width="1" height="1" fill="#1a1a1a" opacity="0.5" />
              <rect x="2" y="1" width="1" height="1" fill="#0a0a0a" opacity="0.3" />
              <rect x="1" y="2" width="1" height="1" fill="#1a1a1a" opacity="0.4" />
            </pattern>

            {/* Truck metal gradient */}
            <linearGradient id={truckId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#9A9A9A" />
              <stop offset="50%" stopColor="#7A7A7A" />
              <stop offset="100%" stopColor="#8A8A8A" />
            </linearGradient>

            {/* Wheel gradient — urethane look */}
            <radialGradient id={wheelId} cx="50%" cy="40%" r="50%">
              <stop offset="0%" stopColor="#F5F0EA" />
              <stop offset="60%" stopColor="#E8E0D4" />
              <stop offset="100%" stopColor="#D0C8BC" />
            </radialGradient>

            {/* Bolt gradient */}
            <radialGradient id={boltId} cx="40%" cy="40%" r="50%">
              <stop offset="0%" stopColor="#555" />
              <stop offset="100%" stopColor="#333" />
            </radialGradient>
          </defs>

          {/* === COMPLETE BOARD === */}
          <g filter={`url(#shadow-${uid})`}>
            {/* Deck — realistic popsicle shape with proper nose/tail kicks */}
            {/* Maple wood visible as the rail edge */}
            <path
              d="M30 6 C18 6, 8 14, 6 24 L6 36 C8 46, 18 54, 30 54 L310 54 C322 54, 332 46, 334 36 L334 24 C332 14, 322 6, 310 6 Z"
              fill={`url(#${woodId})`}
            />

            {/* Wood ply lines on the rail — visible maple layers */}
            <path
              d="M30 6 C18 6, 8 14, 6 24 L6 36 C8 46, 18 54, 30 54"
              fill="none"
              stroke="#A06828"
              strokeWidth="0.5"
              opacity="0.6"
            />
            <path
              d="M310 6 C322 6, 332 14, 334 24 L334 36 C332 46, 322 54, 310 54"
              fill="none"
              stroke="#A06828"
              strokeWidth="0.5"
              opacity="0.6"
            />

            {/* Grip tape — black, slightly inset from edges */}
            <path
              d="M32 8 C20 8, 11 15, 9 24 L9 36 C11 45, 20 52, 32 52 L308 52 C320 52, 329 45, 331 36 L331 24 C329 15, 320 8, 308 8 Z"
              fill={`url(#${gripId})`}
            />

            {/* Subtle grip tape edge highlight */}
            <path
              d="M32 8 C20 8, 11 15, 9 24 L9 36 C11 45, 20 52, 32 52 L308 52 C320 52, 329 45, 331 36 L331 24 C329 15, 320 8, 308 8 Z"
              fill="none"
              stroke="#333"
              strokeWidth="0.5"
              opacity="0.4"
            />

            {/* Front hardware bolts (4 bolts in a square pattern) */}
            <circle cx="62" cy="22" r="2" fill={`url(#${boltId})`} />
            <circle cx="62" cy="38" r="2" fill={`url(#${boltId})`} />
            <circle cx="74" cy="22" r="2" fill={`url(#${boltId})`} />
            <circle cx="74" cy="38" r="2" fill={`url(#${boltId})`} />
            {/* Bolt cross slots */}
            <line x1="60" y1="22" x2="64" y2="22" stroke="#222" strokeWidth="0.6" />
            <line x1="62" y1="20" x2="62" y2="24" stroke="#222" strokeWidth="0.6" />
            <line x1="60" y1="38" x2="64" y2="38" stroke="#222" strokeWidth="0.6" />
            <line x1="62" y1="36" x2="62" y2="40" stroke="#222" strokeWidth="0.6" />
            <line x1="72" y1="22" x2="76" y2="22" stroke="#222" strokeWidth="0.6" />
            <line x1="74" y1="20" x2="74" y2="24" stroke="#222" strokeWidth="0.6" />
            <line x1="72" y1="38" x2="76" y2="38" stroke="#222" strokeWidth="0.6" />
            <line x1="74" y1="36" x2="74" y2="40" stroke="#222" strokeWidth="0.6" />

            {/* Rear hardware bolts */}
            <circle cx="266" cy="22" r="2" fill={`url(#${boltId})`} />
            <circle cx="266" cy="38" r="2" fill={`url(#${boltId})`} />
            <circle cx="278" cy="22" r="2" fill={`url(#${boltId})`} />
            <circle cx="278" cy="38" r="2" fill={`url(#${boltId})`} />
            {/* Bolt cross slots */}
            <line x1="264" y1="22" x2="268" y2="22" stroke="#222" strokeWidth="0.6" />
            <line x1="266" y1="20" x2="266" y2="24" stroke="#222" strokeWidth="0.6" />
            <line x1="264" y1="38" x2="268" y2="38" stroke="#222" strokeWidth="0.6" />
            <line x1="266" y1="36" x2="266" y2="40" stroke="#222" strokeWidth="0.6" />
            <line x1="276" y1="22" x2="280" y2="22" stroke="#222" strokeWidth="0.6" />
            <line x1="278" y1="20" x2="278" y2="24" stroke="#222" strokeWidth="0.6" />
            <line x1="276" y1="38" x2="280" y2="38" stroke="#222" strokeWidth="0.6" />
            <line x1="278" y1="36" x2="278" y2="40" stroke="#222" strokeWidth="0.6" />
          </g>

          {/* === TRUCKS (below deck) === */}
          {/* Front truck — T-shaped hanger */}
          <rect x="48" y="55" width="56" height="3.5" rx="1.5" fill={`url(#${truckId})`} />
          <rect x="63" y="55" width="26" height="5" rx="1" fill="#666" />
          {/* Kingpin */}
          <circle cx="76" cy="58" r="1.5" fill="#888" />

          {/* Rear truck */}
          <rect x="236" y="55" width="56" height="3.5" rx="1.5" fill={`url(#${truckId})`} />
          <rect x="251" y="55" width="26" height="5" rx="1" fill="#666" />
          {/* Kingpin */}
          <circle cx="264" cy="58" r="1.5" fill="#888" />

          {/* === WHEELS === */}
          {/* Front-left */}
          <g className="origin-center group-hover:animate-spin" style={{ transformOrigin: "52px 66px" }}>
            <circle cx="52" cy="66" r="7" fill={`url(#${wheelId})`} stroke="#B0A898" strokeWidth="0.8" />
            <circle cx="52" cy="66" r="4" fill="#C8C0B4" />
            <circle cx="52" cy="66" r="2.5" fill="#A09888" stroke="#8A8278" strokeWidth="0.5" />
            <circle cx="52" cy="66" r="1" fill="#706860" />
          </g>
          {/* Front-right */}
          <g className="origin-center group-hover:animate-spin" style={{ transformOrigin: "100px 66px" }}>
            <circle cx="100" cy="66" r="7" fill={`url(#${wheelId})`} stroke="#B0A898" strokeWidth="0.8" />
            <circle cx="100" cy="66" r="4" fill="#C8C0B4" />
            <circle cx="100" cy="66" r="2.5" fill="#A09888" stroke="#8A8278" strokeWidth="0.5" />
            <circle cx="100" cy="66" r="1" fill="#706860" />
          </g>
          {/* Rear-left */}
          <g className="origin-center group-hover:animate-spin" style={{ transformOrigin: "240px 66px" }}>
            <circle cx="240" cy="66" r="7" fill={`url(#${wheelId})`} stroke="#B0A898" strokeWidth="0.8" />
            <circle cx="240" cy="66" r="4" fill="#C8C0B4" />
            <circle cx="240" cy="66" r="2.5" fill="#A09888" stroke="#8A8278" strokeWidth="0.5" />
            <circle cx="240" cy="66" r="1" fill="#706860" />
          </g>
          {/* Rear-right */}
          <g className="origin-center group-hover:animate-spin" style={{ transformOrigin: "288px 66px" }}>
            <circle cx="288" cy="66" r="7" fill={`url(#${wheelId})`} stroke="#B0A898" strokeWidth="0.8" />
            <circle cx="288" cy="66" r="4" fill="#C8C0B4" />
            <circle cx="288" cy="66" r="2.5" fill="#A09888" stroke="#8A8278" strokeWidth="0.5" />
            <circle cx="288" cy="66" r="1" fill="#706860" />
          </g>
        </svg>

        {/* Text overlay on the grip tape */}
        <span className="absolute inset-0 flex items-center justify-center font-display text-xl tracking-wider text-white pb-3 select-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)] [text-shadow:0_0_12px_rgba(255,107,0,0.25)]">
          {children}
        </span>
      </div>
    </button>
  );
}
