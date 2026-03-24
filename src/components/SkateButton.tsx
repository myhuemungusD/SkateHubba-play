import { useState, type ReactNode } from "react";
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

  const handleClick = () => {
    if (disabled) return;
    setPopping(true);
    playOlliePop();
    setTimeout(() => setPopping(false), 500);
    onClick?.();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`group relative w-full disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-orange ${className}`}
    >
      <div className={`relative transition-transform ${popping ? "animate-ollie" : ""}`}>
        <svg
          viewBox="0 0 320 72"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-auto"
          aria-hidden="true"
        >
          {/* Deck shape — kicked nose and tail */}
          <path
            d="M28 8 C12 8, 4 18, 6 28 L8 44 C10 52, 18 56, 28 56 L292 56 C302 56, 310 52, 312 44 L314 28 C316 18, 308 8, 292 8 Z"
            fill="url(#deckGrad)"
            stroke="url(#deckStroke)"
            strokeWidth="1.5"
          />
          {/* Grip tape */}
          <rect x="32" y="12" width="256" height="40" rx="8" fill="#1a1a1a" opacity="0.7" />
          {/* Deck shine */}
          <rect x="32" y="12" width="256" height="20" rx="8" fill="url(#deckShineGrad)" opacity="0.3" />

          {/* Front truck */}
          <rect x="56" y="56" width="40" height="4" rx="2" fill="#888" />
          {/* Rear truck */}
          <rect x="224" y="56" width="40" height="4" rx="2" fill="#888" />

          {/* Front-left wheel */}
          <g className="origin-center group-hover:animate-spin" style={{ transformOrigin: "60px 66px" }}>
            <circle cx="60" cy="66" r="6" fill="#E8E0D8" stroke="#999" strokeWidth="1" />
            <circle cx="60" cy="66" r="2.5" fill="#aaa" />
          </g>
          {/* Front-right wheel */}
          <g className="origin-center group-hover:animate-spin" style={{ transformOrigin: "92px 66px" }}>
            <circle cx="92" cy="66" r="6" fill="#E8E0D8" stroke="#999" strokeWidth="1" />
            <circle cx="92" cy="66" r="2.5" fill="#aaa" />
          </g>
          {/* Rear-left wheel */}
          <g className="origin-center group-hover:animate-spin" style={{ transformOrigin: "228px 66px" }}>
            <circle cx="228" cy="66" r="6" fill="#E8E0D8" stroke="#999" strokeWidth="1" />
            <circle cx="228" cy="66" r="2.5" fill="#aaa" />
          </g>
          {/* Rear-right wheel */}
          <g className="origin-center group-hover:animate-spin" style={{ transformOrigin: "260px 66px" }}>
            <circle cx="260" cy="66" r="6" fill="#E8E0D8" stroke="#999" strokeWidth="1" />
            <circle cx="260" cy="66" r="2.5" fill="#aaa" />
          </g>

          <defs>
            <linearGradient id="deckGrad" x1="0" y1="0" x2="320" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#CC5500" />
              <stop offset="50%" stopColor="#FF6B00" />
              <stop offset="100%" stopColor="#CC5500" />
            </linearGradient>
            <linearGradient id="deckStroke" x1="0" y1="0" x2="320" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#993D00" />
              <stop offset="50%" stopColor="#FF8533" />
              <stop offset="100%" stopColor="#993D00" />
            </linearGradient>
            <linearGradient id="deckShineGrad" x1="160" y1="12" x2="160" y2="32" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="white" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>

        {/* Text overlay on the deck */}
        <span className="absolute inset-0 flex items-center justify-center font-display text-xl tracking-wider text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] pb-2">
          {children}
        </span>
      </div>
    </button>
  );
}
