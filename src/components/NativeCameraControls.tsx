import { useEffect, useRef, useState, type PointerEvent } from "react";
import { focusNativeAt, getNativeLenses, setNativeLens } from "../services/nativeVideo";

const LONG_PRESS_MS = 500;

/**
 * Native-only capture controls layered on the live camera: a 0.5x / 1x / 2x
 * lens bar (works mid-take, like the iPhone Camera app) and tap-to-focus,
 * press-and-hold to lock focus + exposure. Rendered under the crosshair layer
 * and never moves or restyles it. Renders nothing when the native camera
 * reports no lens info (Android / unpatched builds).
 */
export function NativeCameraControls({ active }: { active: boolean }) {
  const [lenses, setLenses] = useState<number[]>([]);
  const [lens, setLens] = useState(1);
  const [locked, setLocked] = useState(false);
  const [focusPt, setFocusPt] = useState<{ x: number; y: number } | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    // The camera finishes warming up just after "recording" flips on; one retry covers it.
    const load = async (tries: number) => {
      const l = await getNativeLenses();
      if (cancelled) return;
      if (l.length === 0 && tries > 0) setTimeout(() => void load(tries - 1), 400);
      else setLenses(l);
    };
    void load(3);
    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(
    () => () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
    },
    [],
  );

  if (!active || lenses.length === 0) return null;

  const point = (e: PointerEvent) => ({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    const p = point(e);
    const rect = e.currentTarget.getBoundingClientRect();
    setFocusPt({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      setLocked(true);
      void focusNativeAt(p.x, p.y, true);
    }, LONG_PRESS_MS);
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    if (longPressed.current) return;
    const p = point(e);
    setLocked(false);
    void focusNativeAt(p.x, p.y, false);
  };

  const pick = (l: number) => {
    setLens(l);
    void setNativeLens(l);
  };

  return (
    <>
      <div
        data-testid="native-focus-layer"
        aria-hidden="true"
        className="absolute inset-0"
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={() => pressTimer.current && clearTimeout(pressTimer.current)}
      >
        {focusPt && (
          <span
            className={`pointer-events-none absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-md border-2 ${locked ? "border-amber-300" : "border-white/80"}`}
            style={{ left: focusPt.x, top: focusPt.y }}
          />
        )}
      </div>
      {locked && (
        <span
          data-testid="ae-af-lock"
          className="absolute top-4 left-4 rounded-md bg-amber-300 px-2 py-1 font-display text-[11px] tracking-[0.1em] text-black"
        >
          AE/AF LOCK
        </span>
      )}
      <div
        role="group"
        aria-label="Lens"
        className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1 rounded-full bg-black/50 p-1 backdrop-blur-sm"
      >
        {lenses.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={lens === l}
            aria-label={l === 0.5 ? "Ultra-wide lens 0.5x" : `${l}x lens`}
            onClick={() => pick(l)}
            className={`h-11 min-w-11 rounded-full px-2 font-display text-xs ${lens === l ? "bg-white/90 text-black" : "text-white"}`}
          >
            {l === 0.5 ? ".5" : l}×
          </button>
        ))}
      </div>
    </>
  );
}
