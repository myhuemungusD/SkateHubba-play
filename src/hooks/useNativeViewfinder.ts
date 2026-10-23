import { useEffect, type RefObject } from "react";

/** Breathing room between the viewfinder and the pinned action dock. */
const DOCK_GAP_PX = 12;

/** Top edge of the highest fixed action dock, or the viewport bottom. */
function dockTop(): number {
  let top = window.innerHeight;
  document.querySelectorAll(".action-dock").forEach((dock) => {
    top = Math.min(top, dock.getBoundingClientRect().top);
  });
  return top;
}

/**
 * Native capture draws the camera BEHIND the web view, so while it is live:
 *
 * 1. every ancestor of the viewfinder is marked see-through (.sh-native-cam).
 *    Marked directly instead of a global `*:has(...)` rule, which made Chrome
 *    re-check ancestors on every DOM mutation and blew the Lighthouse TBT
 *    budget on pages that never open the camera.
 * 2. the viewfinder is scrolled clear of the pinned action dock. The setter's
 *    scoreboard + trick picker, or the matcher's 55dvh setter clip, otherwise
 *    leave it under the fold — the camera "runs" with nothing on screen. The
 *    viewfinder itself never moves or resizes, so neither does the crosshair.
 */
export function useNativeViewfinder(viewfinderRef: RefObject<HTMLElement | null>, nativeLive: boolean): void {
  useEffect(() => {
    const viewfinder = viewfinderRef.current;
    if (!nativeLive || !viewfinder) return;
    const marked: Element[] = [];
    for (let el = viewfinder.parentElement; el; el = el.parentElement) {
      el.classList.add("sh-native-cam");
      marked.push(el);
    }
    const limit = dockTop();
    const rect = viewfinder.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > limit - DOCK_GAP_PX) {
      viewfinder.style.scrollMarginBottom = `${window.innerHeight - limit + DOCK_GAP_PX}px`;
      viewfinder.scrollIntoView?.({ block: "end", behavior: "smooth" });
    }
    return () => marked.forEach((el) => el.classList.remove("sh-native-cam"));
  }, [viewfinderRef, nativeLive]);
}
