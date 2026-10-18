import { useEffect, type RefObject } from "react";

/** Distance (px) a downward drag must travel before the sheet closes. */
export const SWIPE_CLOSE_THRESHOLD = 80;

/**
 * iOS-style pull-down-to-dismiss for sheets and full-screen modals. Only
 * arms when the gesture starts with the sheet scrolled to the top, so it
 * never fights normal scrolling (the Instagram comments-sheet behaviour).
 */
export function useSwipeDownToClose(ref: RefObject<HTMLElement | null>, onClose: () => void, enabled = true): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let startY: number | null = null;
    const onStart = (e: TouchEvent) => {
      startY = el.scrollTop <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
    };
    const onEnd = (e: TouchEvent) => {
      if (startY === null) return;
      const from = startY;
      startY = null;
      const to = e.changedTouches[0]?.clientY ?? from;
      if (to - from >= SWIPE_CLOSE_THRESHOLD) onClose();
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
    };
  }, [ref, onClose, enabled]);
}
