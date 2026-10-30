import { useEffect, useRef, useState, type ReactNode } from "react";
import { hapticForVariant, playHaptic } from "../services/haptics";

const DECK = "M30 4 C18 4 8 12 6 22 L6 34 C8 44 18 52 30 52 L310 52 C322 52 332 44 334 34 L334 22 C332 12 322 4 310 4 Z";
const GRIP = "M32 7 C21 7 12 14 10 23 L10 33 C12 42 21 49 32 49 L308 49 C319 49 328 42 330 33 L330 23 C328 14 319 7 308 7 Z";
const BOLTS = [62, 74, 266, 278].flatMap((cx) => [
  { cx, cy: 20 },
  { cx, cy: 36 },
]);

/**
 * Flat skateboard-deck CTA for Landing v2: hubba rails, black grip, chalk
 * label. No shadow or shine; the ollie plays once, only when pressed.
 */
export function DeckButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  const [popping, setPopping] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const press = () => {
    setPopping(true);
    playHaptic(hapticForVariant("primary"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPopping(false), 500);
    onClick();
  };

  return (
    <button
      type="button"
      onClick={press}
      disabled={disabled}
      data-testid="landing-v2-deck"
      className="group relative block w-full rounded-ct transition-transform duration-[120ms] ease-ct active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ct-chalk"
    >
      <span className={`relative block ${popping ? "animate-ollie" : ""}`}>
        <svg viewBox="0 0 340 56" className="block h-auto w-full" aria-hidden="true" focusable="false">
          <path
            d={DECK}
            className="fill-ct-hubba transition-colors duration-[200ms] ease-ct group-hover:fill-ct-hubba-hover"
          />
          <path d={GRIP} className="fill-ct-ink" />
          {BOLTS.map((b) => (
            <circle key={`${b.cx}-${b.cy}`} cx={b.cx} cy={b.cy} r="2.25" className="fill-ct-line-strong" />
          ))}
        </svg>
        <span className="absolute inset-0 flex select-none items-center justify-center font-display text-2xl tracking-[0.01em] text-ct-chalk">
          {children}
        </span>
      </span>
    </button>
  );
}
