import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface SpotlightOverlayProps {
  /** CSS selector of the element to highlight; if absent, no ring is painted. */
  targetSelector?: string;
  reducedMotion: boolean;
  /** Tap-on-backdrop handler. Called when the user taps anywhere outside the bubble. */
  onBackdropTap?: () => void;
  children: ReactNode;
}

const PADDING = 8;

function readRect(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el || !(el instanceof HTMLElement)) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top - PADDING, left: r.left - PADDING, width: r.width + PADDING * 2, height: r.height + PADDING * 2 };
}

/**
 * Non-blocking coach-mark frame: paints an optional pulsing ring around a
 * target element and renders the bubble pinned to the bottom of the viewport.
 * Unlike the previous full-screen modal treatment, the underlying app stays
 * fully interactive — taps anywhere outside the bubble flow through to the
 * page (and optionally fire `onBackdropTap` to dismiss the tour).
 *
 * Pokemon-Go-style: the user can keep using the app while the tour points at
 * the relevant control. This means no `inert`, no focus trap, no
 * `aria-modal` — those would all imply blocking the page.
 */
export function SpotlightOverlay({ targetSelector, reducedMotion, onBackdropTap, children }: SpotlightOverlayProps) {
  const [rect, setRect] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    if (!targetSelector) return;

    // rAF-coalesce scroll/resize so multiple events per frame trigger a
    // single getBoundingClientRect (forced layout) + setState. Otherwise
    // every scroll tick on low-end mobile would stutter the overlay. The
    // initial measurement is also deferred to rAF so we never call setState
    // synchronously inside the effect body (react-hooks/set-state-in-effect).
    let rafId = 0;
    const update = () => {
      if (rafId !== 0) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        setRect(readRect(targetSelector));
      });
    };
    update();

    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, { passive: true, capture: true });
    return () => {
      if (rafId !== 0) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, { capture: true });
    };
  }, [targetSelector]);

  // When the selector is removed, clear any previously-computed rect so the
  // ring disappears.
  const effectiveRect = targetSelector ? rect : null;

  // Backdrop tap-to-dismiss: a transparent layer sits behind the bubble and
  // catches taps. Pointer-events stay off the rest of the overlay so the
  // pulsing ring never steals input from the highlighted control.
  useEffect(() => {
    if (!onBackdropTap) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Ignore clicks that originate inside the bubble itself or on the
      // highlighted control — the user should be able to interact with the
      // anchored element without dismissing the coach mark.
      if (target.closest('[data-testid="mascot-bubble"]')) return;
      if (targetSelector && target.closest(targetSelector)) return;
      onBackdropTap();
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [onBackdropTap, targetSelector]);

  const ringPulse = reducedMotion ? "" : "motion-safe:animate-pulse";

  return (
    <div className="fixed inset-0 z-[60] pointer-events-none" data-testid="spotlight-overlay">
      {effectiveRect && (
        <>
          {/* Soft glow halo behind the ring for depth without dimming the page */}
          <div
            aria-hidden="true"
            data-testid="spotlight-cutout"
            className="absolute rounded-2xl pointer-events-none"
            style={{
              top: effectiveRect.top,
              left: effectiveRect.left,
              width: effectiveRect.width,
              height: effectiveRect.height,
              boxShadow: "0 0 0 4px rgba(255, 107, 0, 0.18), 0 0 32px 8px rgba(255, 107, 0, 0.25)",
            }}
          />
          {/* Pulsing accent ring around the highlighted target */}
          <div
            aria-hidden="true"
            className={`absolute rounded-2xl border-2 border-brand-orange pointer-events-none ${ringPulse}`}
            style={{
              top: effectiveRect.top,
              left: effectiveRect.left,
              width: effectiveRect.width,
              height: effectiveRect.height,
            }}
          />
        </>
      )}

      {/* Bubble pinned to bottom-center, above the bottom nav. pointer-events-auto
          on the bubble itself so it's tappable; the surrounding layer stays
          transparent so the rest of the page is fully interactable. */}
      <div className="absolute inset-x-0 bottom-0 flex justify-center px-4 pb-safe pointer-events-none">
        <div className="pointer-events-auto w-full max-w-md mb-20 sm:mb-6">{children}</div>
      </div>
    </div>
  );
}
