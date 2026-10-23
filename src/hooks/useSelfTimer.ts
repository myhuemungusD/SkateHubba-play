import { useCallback, useEffect, useRef, useState } from "react";

/** Lead-in, in seconds, for the solo-filming self-timer. */
export const SELF_TIMER_SECONDS = 3;

export interface SelfTimer {
  /** Whether a tap on Record waits out the countdown first. Off by default. */
  enabled: boolean;
  toggle: () => void;
  /** Seconds left on a running countdown, or null when none is running. */
  countdown: number | null;
  /** Run `fire` now (timer off) or after the countdown (timer on). */
  start: (fire: () => void) => void;
  /** Abandon a running countdown without firing. */
  cancel: () => void;
}

/**
 * 3-2-1 self-timer for skaters filming alone: prop the phone up, tap Record,
 * get into position. Capture only starts when the count reaches zero.
 */
export function useSelfTimer(): SelfTimer {
  const [enabled, setEnabled] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const tickRef = useRef<number>(0);

  const cancel = useCallback(() => {
    window.clearInterval(tickRef.current);
    tickRef.current = 0;
    setCountdown(null);
  }, []);

  const start = useCallback(
    (fire: () => void) => {
      if (!enabled) {
        fire();
        return;
      }
      window.clearInterval(tickRef.current);
      let left = SELF_TIMER_SECONDS;
      setCountdown(left);
      tickRef.current = window.setInterval(() => {
        left -= 1;
        if (left > 0) {
          setCountdown(left);
          return;
        }
        window.clearInterval(tickRef.current);
        tickRef.current = 0;
        setCountdown(null);
        fire();
      }, 1000);
    },
    [enabled],
  );

  const toggle = useCallback(() => setEnabled((v) => !v), []);

  useEffect(() => () => window.clearInterval(tickRef.current), []);

  return { enabled, toggle, countdown, start, cancel };
}
