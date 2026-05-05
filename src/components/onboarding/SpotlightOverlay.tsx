import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface SpotlightOverlayProps {
  /** CSS selector of the element to highlight; if absent, the overlay is plain dim. */
  targetSelector?: string;
  reducedMotion: boolean;
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
 * Full-screen dim with an optional rectangular "cutout" highlighting a target
 * element. The cutout is faked via a thick 9999px box-shadow on a transparent
 * div so we don't need an SVG mask — keeps the implementation under 200 LOC
 * and works in every browser without compositing tricks.
 *
 * The `inert` attribute is applied to #main-content while mounted so the
 * underlying app can't be clicked / tabbed into. Cleanup restores the prior
 * inert state on unmount, even if it was inert for unrelated reasons.
 */
export function SpotlightOverlay({ targetSelector, reducedMotion, children }: SpotlightOverlayProps) {
  const [rect, setRect] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    if (!targetSelector) return;

    const update = () => setRect(readRect(targetSelector));
    update();

    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, { passive: true, capture: true });
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, { capture: true });
    };
  }, [targetSelector]);

  // When the selector is removed, clear any previously-computed rect so the
  // backdrop falls back to the plain dim.
  const effectiveRect = targetSelector ? rect : null;

  // Lock the underlying app while the overlay is mounted so screen readers and
  // keyboard users can't tab past the dialog. Mirrors the WAI-ARIA modal recipe.
  useEffect(() => {
    const el = document.getElementById("main-content");
    if (!el) return;
    const prev = el.hasAttribute("inert");
    el.setAttribute("inert", "");
    return () => {
      if (!prev) el.removeAttribute("inert");
    };
  }, []);

  const ringPulse = reducedMotion ? "" : "motion-safe:animate-pulse";

  return (
    <div className="fixed inset-0 z-[60]" data-testid="spotlight-overlay">
      {effectiveRect ? (
        <>
          {/* Cutout: transparent rect with a huge outer shadow that paints the dim everywhere else */}
          <div
            aria-hidden="true"
            data-testid="spotlight-cutout"
            className="absolute rounded-2xl pointer-events-none"
            style={{
              top: effectiveRect.top,
              left: effectiveRect.left,
              width: effectiveRect.width,
              height: effectiveRect.height,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.72)",
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
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      )}

      <div className="absolute inset-0 flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-0 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
