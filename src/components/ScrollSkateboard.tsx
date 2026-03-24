import { useState, useEffect, useRef } from "react";

/** A detailed vertical skateboard that sits on the right side of the screen.
 *  The wheels spin proportionally to the page scroll position. */
export function ScrollSkateboard() {
  const [wheelRotation, setWheelRotation] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const onScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        // 1 full rotation per 200px of scroll
        setWheelRotation(window.scrollY * (360 / 200));
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="fixed right-4 top-1/2 -translate-y-1/2 z-10 pointer-events-none hidden lg:block" aria-hidden="true">
      <svg
        width="72"
        height="420"
        viewBox="0 0 72 420"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ filter: "drop-shadow(0 0 18px rgba(255,107,0,0.25))" }}
      >
        {/* ── Deck ─────────────────────────────────────── */}
        {/* Main deck shape — rounded ends, slight concave */}
        <path
          d="M20 50 C20 22, 52 22, 52 50 L54 370 C54 398, 18 398, 20 370 Z"
          fill="url(#deckGrain)"
          stroke="url(#deckEdge)"
          strokeWidth="1.5"
        />
        {/* Deck top highlight (concave shine) */}
        <path d="M26 55 C26 35, 46 35, 46 55 L47 365 C47 385, 25 385, 26 365 Z" fill="url(#deckShine)" opacity="0.5" />

        {/* ── Grip tape texture ────────────────────────── */}
        <rect x="24" y="60" width="24" height="300" rx="4" fill="url(#gripTape)" opacity="0.6" />

        {/* ── Deck graphic — flame / brand mark ────────── */}
        <g opacity="0.9">
          {/* Stylized "S" brand mark */}
          <path
            d="M36 160 C28 170, 28 180, 36 185 C44 190, 44 200, 36 210"
            stroke="#FF6B00"
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
          />
          <path d="M36 185 L42 182 L36 190 L30 187 Z" fill="#FF6B00" opacity="0.7" />
          {/* Small stars / accents */}
          <circle cx="30" cy="230" r="1.5" fill="#FF8533" opacity="0.6" />
          <circle cx="42" cy="240" r="1" fill="#FF8533" opacity="0.5" />
          <circle cx="33" cy="250" r="1.2" fill="#FF6B00" opacity="0.4" />
        </g>

        {/* ── Nose kick ────────────────────────────────── */}
        <ellipse cx="36" cy="42" rx="14" ry="8" fill="url(#deckGrain)" stroke="url(#deckEdge)" strokeWidth="1" />

        {/* ── Tail kick ────────────────────────────────── */}
        <ellipse cx="36" cy="378" rx="15" ry="9" fill="url(#deckGrain)" stroke="url(#deckEdge)" strokeWidth="1" />

        {/* ── Front truck ──────────────────────────────── */}
        <g>
          {/* Baseplate */}
          <rect x="22" y="72" width="28" height="6" rx="2" fill="#888" stroke="#666" strokeWidth="0.5" />
          {/* Hanger */}
          <rect x="14" y="78" width="44" height="5" rx="2.5" fill="#aaa" stroke="#888" strokeWidth="0.5" />
          {/* Kingpin */}
          <circle cx="36" cy="75" r="2" fill="#999" stroke="#777" strokeWidth="0.5" />
          {/* Axle */}
          <rect x="10" y="80" width="52" height="2" rx="1" fill="#999" />
        </g>

        {/* ── Rear truck ───────────────────────────────── */}
        <g>
          <rect x="22" y="342" width="28" height="6" rx="2" fill="#888" stroke="#666" strokeWidth="0.5" />
          <rect x="14" y="348" width="44" height="5" rx="2.5" fill="#aaa" stroke="#888" strokeWidth="0.5" />
          <circle cx="36" cy="345" r="2" fill="#999" stroke="#777" strokeWidth="0.5" />
          <rect x="10" y="350" width="52" height="2" rx="1" fill="#999" />
        </g>

        {/* ── Front-left wheel ─────────────────────────── */}
        <g transform={`rotate(${wheelRotation} 14 82)`}>
          <circle cx="14" cy="82" r="10" fill="url(#wheelFace)" stroke="#555" strokeWidth="1" />
          <circle cx="14" cy="82" r="6" fill="none" stroke="#666" strokeWidth="0.5" opacity="0.5" />
          <circle cx="14" cy="82" r="3" fill="#777" stroke="#555" strokeWidth="0.5" />
          {/* Spokes */}
          <line x1="14" y1="73" x2="14" y2="91" stroke="#666" strokeWidth="0.5" opacity="0.4" />
          <line x1="5" y1="82" x2="23" y2="82" stroke="#666" strokeWidth="0.5" opacity="0.4" />
          <line x1="7.4" y1="75.4" x2="20.6" y2="88.6" stroke="#666" strokeWidth="0.5" opacity="0.3" />
          <line x1="20.6" y1="75.4" x2="7.4" y2="88.6" stroke="#666" strokeWidth="0.5" opacity="0.3" />
        </g>

        {/* ── Front-right wheel ────────────────────────── */}
        <g transform={`rotate(${wheelRotation} 58 82)`}>
          <circle cx="58" cy="82" r="10" fill="url(#wheelFace)" stroke="#555" strokeWidth="1" />
          <circle cx="58" cy="82" r="6" fill="none" stroke="#666" strokeWidth="0.5" opacity="0.5" />
          <circle cx="58" cy="82" r="3" fill="#777" stroke="#555" strokeWidth="0.5" />
          <line x1="58" y1="73" x2="58" y2="91" stroke="#666" strokeWidth="0.5" opacity="0.4" />
          <line x1="49" y1="82" x2="67" y2="82" stroke="#666" strokeWidth="0.5" opacity="0.4" />
          <line x1="51.4" y1="75.4" x2="64.6" y2="88.6" stroke="#666" strokeWidth="0.5" opacity="0.3" />
          <line x1="64.6" y1="75.4" x2="51.4" y2="88.6" stroke="#666" strokeWidth="0.5" opacity="0.3" />
        </g>

        {/* ── Rear-left wheel ──────────────────────────── */}
        <g transform={`rotate(${wheelRotation} 14 352)`}>
          <circle cx="14" cy="352" r="10" fill="url(#wheelFace2)" stroke="#555" strokeWidth="1" />
          <circle cx="14" cy="352" r="6" fill="none" stroke="#666" strokeWidth="0.5" opacity="0.5" />
          <circle cx="14" cy="352" r="3" fill="#777" stroke="#555" strokeWidth="0.5" />
          <line x1="14" y1="343" x2="14" y2="361" stroke="#666" strokeWidth="0.5" opacity="0.4" />
          <line x1="5" y1="352" x2="23" y2="352" stroke="#666" strokeWidth="0.5" opacity="0.4" />
          <line x1="7.4" y1="345.4" x2="20.6" y2="358.6" stroke="#666" strokeWidth="0.5" opacity="0.3" />
          <line x1="20.6" y1="345.4" x2="7.4" y2="358.6" stroke="#666" strokeWidth="0.5" opacity="0.3" />
        </g>

        {/* ── Rear-right wheel ─────────────────────────── */}
        <g transform={`rotate(${wheelRotation} 58 352)`}>
          <circle cx="58" cy="352" r="10" fill="url(#wheelFace2)" stroke="#555" strokeWidth="1" />
          <circle cx="58" cy="352" r="6" fill="none" stroke="#666" strokeWidth="0.5" opacity="0.5" />
          <circle cx="58" cy="352" r="3" fill="#777" stroke="#555" strokeWidth="0.5" />
          <line x1="58" y1="343" x2="58" y2="361" stroke="#666" strokeWidth="0.5" opacity="0.4" />
          <line x1="49" y1="352" x2="67" y2="352" stroke="#666" strokeWidth="0.5" opacity="0.4" />
          <line x1="51.4" y1="345.4" x2="64.6" y2="358.6" stroke="#666" strokeWidth="0.5" opacity="0.3" />
          <line x1="64.6" y1="345.4" x2="51.4" y2="358.6" stroke="#666" strokeWidth="0.5" opacity="0.3" />
        </g>

        {/* ── Hardware bolts ───────────────────────────── */}
        {[68, 70, 74, 76].map((y) => (
          <g key={`fb-${y}`}>
            <circle cx="28" cy={y} r="1.5" fill="#555" stroke="#444" strokeWidth="0.3" />
            <circle cx="44" cy={y} r="1.5" fill="#555" stroke="#444" strokeWidth="0.3" />
          </g>
        ))}
        {[340, 342, 346, 348].map((y) => (
          <g key={`rb-${y}`}>
            <circle cx="28" cy={y} r="1.5" fill="#555" stroke="#444" strokeWidth="0.3" />
            <circle cx="44" cy={y} r="1.5" fill="#555" stroke="#444" strokeWidth="0.3" />
          </g>
        ))}

        {/* ── Defs (gradients & patterns) ──────────────── */}
        <defs>
          <linearGradient id="deckGrain" x1="20" y1="50" x2="52" y2="50" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#3D2B1F" />
            <stop offset="30%" stopColor="#5C3A24" />
            <stop offset="70%" stopColor="#5C3A24" />
            <stop offset="100%" stopColor="#3D2B1F" />
          </linearGradient>
          <linearGradient id="deckEdge" x1="20" y1="0" x2="52" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#2A1A0F" />
            <stop offset="50%" stopColor="#6B4430" />
            <stop offset="100%" stopColor="#2A1A0F" />
          </linearGradient>
          <linearGradient id="deckShine" x1="26" y1="0" x2="46" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="transparent" />
            <stop offset="50%" stopColor="rgba(255,255,255,0.08)" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
          <radialGradient id="wheelFace" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#E8E0D8" />
            <stop offset="60%" stopColor="#D4C8BC" />
            <stop offset="100%" stopColor="#A89888" />
          </radialGradient>
          <radialGradient id="wheelFace2" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#E8E0D8" />
            <stop offset="60%" stopColor="#D4C8BC" />
            <stop offset="100%" stopColor="#A89888" />
          </radialGradient>
          <pattern id="gripTape" width="4" height="4" patternUnits="userSpaceOnUse">
            <rect width="4" height="4" fill="#1a1a1a" />
            <circle cx="1" cy="1" r="0.5" fill="#222" />
            <circle cx="3" cy="3" r="0.5" fill="#222" />
          </pattern>
        </defs>
      </svg>
    </div>
  );
}
