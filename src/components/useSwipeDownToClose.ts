import { useEffect, type RefObject } from "react";

/** Distance (px) a downward drag must travel before the sheet closes. */
export const SWIPE_CLOSE_THRESHOLD = 80;

/**
 * iOS-style pull-down-to-dismiss for sheets and full-screen modals. Only
 * arms when the gesture starts with the sheet scrolled to the top, so it
 * never fights normal scrolling (the Instagram comments-sheet behaviour).
 */
/**
 * True when nothing between the touch target and the sheet is scrolled down.
 * Sheets usually scroll an inner `overflow-y-auto` list, not the panel, so
 * checking only the panel let a drag back up a long thread close it (SF-C1).
 * Any element with scrollTop > 0 is a scroller that is mid-scroll.
 */
function atTop(root: HTMLElement, target: EventTarget | null): boolean {
  let node = target instanceof Node ? target : null;
  while (node && node !== root) {
    if (node instanceof HTMLElement && node.scrollTop > 0) return false;
    node = node.parentNode;
  }
  return root.scrollTop <= 0;
}

export function useSwipeDownToClose(ref: RefObject<HTMLElement | null>, onClose: () => void, enabled = true): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let startY: number | null = null;
    const onStart = (e: TouchEvent) => {
      startY = e.touches.length === 1 && atTop(el, e.target) ? e.touches[0].clientY : null;
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
