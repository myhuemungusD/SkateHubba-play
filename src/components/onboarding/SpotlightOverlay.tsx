import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Z_TUTORIAL_OVERLAY_CLASS } from "./constants";
import { logger } from "../../services/logger";

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
  /**
   * Fires when an `IntersectionObserver` confirms the resolved target hasn't
   * intersected the viewport within {@link ANCHOR_TIMEOUT_MS}. Caller should
   * silently advance the tour past this step rather than render a ringless
   * bubble pointing at empty space.
   */
  onAnchorMissing?: () => void;
  children: ReactNode;
}

const PADDING = 8;
const ANCHOR_TIMEOUT_MS = 1500;

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
 * page (dismissal is exposed as an explicit close affordance on the bubble
 * itself; see {@link MascotBubble}).
 *
 * Pokemon-Go-style: the user can keep using the app while the tour points at
 * the relevant control. This means no `inert`, no focus trap, no
 * `aria-modal` — those would all imply blocking the page.
 */
export function SpotlightOverlay({ targetSelector, reducedMotion, onAnchorMissing, children }: SpotlightOverlayProps) {
  const [rect, setRect] = useState<Rect | null>(null);
  // The highlight rect is a runtime measurement (getBoundingClientRect), so its
  // top/left/width/height can't be expressed as build-time Tailwind classes.
  // We write them through the CSSOM via refs instead of an inline `style=`
  // attribute so the CSP `style-src` can drop `'unsafe-inline'` — CSSOM writes
  // (element.style.x = y) are not governed by `style-src`, unlike `style=`.
  const cutoutRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);

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

    // The exact same options object is passed to add and remove so the
    // listener is reliably torn down. Browsers compare the `capture` flag
    // when matching add/remove pairs — a mismatch here would silently leak
    // the listener across tour-step transitions.
    const scrollOptions: AddEventListenerOptions = { passive: true, capture: true };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, scrollOptions);
    return () => {
      if (rafId !== 0) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, scrollOptions);
    };
  }, [targetSelector]);

  // Anchor-missing watchdog: when a step targets a selector that doesn't
  // intersect the viewport within ANCHOR_TIMEOUT_MS, fire the callback so the
  // orchestrator can silently advance past this step. Avoids painting a
  // ringless bubble pointing at an off-screen / DOM-detached control.
  useEffect(() => {
    if (!targetSelector || !onAnchorMissing) return;
    let intersected = false;
    let io: IntersectionObserver | undefined;

    const tryObserve = () => {
      const el = document.querySelector(targetSelector);
      if (!(el instanceof HTMLElement)) return false;
      io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            intersected = true;
            io?.disconnect();
            return;
          }
        }
      });
      io.observe(el);
      return true;
    };

    // The element may not be in the DOM yet (React batching). Retry once after
    // a rAF so layout has a chance to commit before falling through to the
    // timeout-based watchdog.
    if (!tryObserve()) {
      const raf = requestAnimationFrame(() => {
        if (intersected) return;
        tryObserve();
      });
      const earlyCleanup = () => cancelAnimationFrame(raf);
      const timer = window.setTimeout(() => {
        earlyCleanup();
        if (intersected) return;
        io?.disconnect();
        const found = document.querySelector(targetSelector) instanceof HTMLElement;
        logger.warn("tutorial_step_anchor_missing", {
          reason: found ? "no-intersect" : "no-element",
          selector: targetSelector,
        });
        onAnchorMissing();
      }, ANCHOR_TIMEOUT_MS);
      return () => {
        earlyCleanup();
        io?.disconnect();
        window.clearTimeout(timer);
      };
    }

    const timer = window.setTimeout(() => {
      if (intersected) return;
      io?.disconnect();
      logger.warn("tutorial_step_anchor_missing", { reason: "no-intersect", selector: targetSelector });
      onAnchorMissing();
    }, ANCHOR_TIMEOUT_MS);
    return () => {
      io?.disconnect();
      window.clearTimeout(timer);
    };
  }, [targetSelector, onAnchorMissing]);

  // When the selector is removed, clear any previously-computed rect so the
  // ring disappears.
  const effectiveRect = targetSelector ? rect : null;

  // Push the measured geometry onto the cutout + ring via the CSSOM. Runs after
  // the conditional render commits the elements, so the refs are populated when
  // a rect exists and null when it's cleared.
  useLayoutEffect(() => {
    for (const el of [cutoutRef.current, ringRef.current]) {
      if (!el) continue;
      if (effectiveRect) {
        el.style.top = `${effectiveRect.top}px`;
        el.style.left = `${effectiveRect.left}px`;
        el.style.width = `${effectiveRect.width}px`;
        el.style.height = `${effectiveRect.height}px`;
      }
    }
  }, [effectiveRect]);

  const ringPulse = reducedMotion ? "" : "motion-safe:animate-pulse";

  return (
    <div className={`fixed inset-0 pointer-events-none ${Z_TUTORIAL_OVERLAY_CLASS}`} data-testid="spotlight-overlay">
      {effectiveRect && (
        <>
          {/* Soft glow halo behind the ring for depth without dimming the page.
              Geometry is applied via the CSSOM in the layout effect above; the
              static glow shadow stays a Tailwind arbitrary-value class. */}
          <div
            ref={cutoutRef}
            aria-hidden="true"
            data-testid="spotlight-cutout"
            className="absolute rounded-2xl pointer-events-none shadow-[0_0_0_4px_rgba(255,107,0,0.18),0_0_32px_8px_rgba(255,107,0,0.25)]"
          />
          {/* Pulsing accent ring around the highlighted target */}
          <div
            ref={ringRef}
            aria-hidden="true"
            className={`absolute rounded-2xl border-2 border-brand-orange pointer-events-none ${ringPulse}`}
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
