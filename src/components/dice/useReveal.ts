import { useEffect, useEffectEvent, useState } from "react";

/** Gap between dice landing, and how long one landing takes (matches index.css). */
export const LAND_STEP_MS = 110;
export const LAND_MS = 560;
const QUICK_MS = 180;

/**
 * Stages a new roll: dice land one after another, then the result shows.
 * The first roll seen on mount is shown as already landed (no replay of an
 * old roll). A tap can skip straight to the end. `quick` (reduced motion or
 * the Quick rolls setting) lands everything at once.
 */
export function useReveal(
  key: string | null,
  count: number,
  quick: boolean,
  onLand: (index: number) => void,
  onDone: () => void,
): { landing: boolean; skip: () => void } {
  const [track, setTrack] = useState<{ key: string | null; landing: boolean }>({ key, landing: false });
  if (track.key !== key) setTrack({ key, landing: key !== null });

  const land = useEffectEvent(onLand);
  const done = useEffectEvent(onDone);

  useEffect(() => {
    if (!track.landing) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = () => {
      setTrack((t) => (t.key === track.key ? { ...t, landing: false } : t));
      done();
    };
    if (quick) {
      land(0);
      timers.push(setTimeout(finish, QUICK_MS));
    } else {
      for (let i = 0; i < count; i++) timers.push(setTimeout(() => land(i), i * LAND_STEP_MS + LAND_MS * 0.6));
      timers.push(setTimeout(finish, (count - 1) * LAND_STEP_MS + LAND_MS));
    }
    return () => timers.forEach(clearTimeout);
  }, [track.landing, track.key, count, quick]);

  return {
    landing: track.landing,
    skip: () => {
      if (!track.landing) return;
      setTrack((t) => ({ ...t, landing: false }));
      onDone();
    },
  };
}
