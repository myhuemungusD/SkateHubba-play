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
  /** "top" pins the bubble under the header instead of above the bottom nav. */
  placement?: "top" | "bottom";
  children: ReactNode;
}

const PADDING = 8;
/** Clips the ring layer to below the top safe area (see readRect). */
export const SPOTLIGHT_CLIP_CLASS =
  "absolute inset-0 pointer-events-none [clip-path:inset(env(safe-area-inset-top,0px)_0_0_0)]";
const ANCHOR_TIMEOUT_MS = 1500;

/**
 * The top safe-area inset in px (status bar / notch / Dynamic Island), read
 * from a probe that resolves `env(safe-area-inset-top)` through the
 * `.pt-safe-inset` utility. 0 where the browser has no inset.
 */
export function readSafeTop(): number {
  const probe = document.createElement("div");
  probe.className = "pt-safe-inset";
  probe.setAttribute("aria-hidden", "true");
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  const px = Number.parseFloat(getComputedStyle(probe).paddingTop);
  probe.remove();
  return Number.isFinite(px) ? px : 0;
}

/**
 * Ring geometry around the target, PADDING px on each side. The top edge is
 * clamped to the safe area: a control flush under the status bar (the feed's
 * camera button) used to push the ring and its glow up behind the Dynamic
 * Island, which read as a stray orange arc at the very top of the screen.
 */
function readRect(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el || !(el instanceof HTMLElement)) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  const top = Math.max(r.top - PADDING, readSafeTop());
  const bottom = r.top + r.height + PADDING;
  return { top, left: r.left - PADDING, width: r.width + PADDING * 2, height: Math.max(0, bottom - top) };
}

/**
 * Where the bubble docks. A bottom bubble moves to the top when its ring
 * target sits in the lower half of the screen (and the reverse), so Hesher
 * never covers the very thing he is pointing at.
 */
export function resolvePlacement(
  placement: "top" | "bottom",
  rect: Rect | null,
  viewportHeight: number,
): "top" | "bottom" {
  if (!rect || viewportHeight <= 0) return placement;
  const center = rect.top + rect.height / 2;
  if (placement === "bottom" && center > viewportHeight / 2) return "top";
  if (placement === "top" && center < viewportHeight / 2) return "bottom";
  return placement;
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
export function SpotlightOverlay({
  targetSelector,
  reducedMotion,
  onAnchorMissing,
  placement = "bottom",
  children,
}: SpotlightOverlayProps) {
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
      // Nothing is observed before this frame, so nothing can have
      // intersected yet: just try again.
      const raf = requestAnimationFrame(() => {
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
    if (!effectiveRect) return;
    for (const el of [cutoutRef.current, ringRef.current].filter((n): n is HTMLDivElement => n !== null)) {
      el.style.top = `${effectiveRect.top}px`;
      el.style.left = `${effectiveRect.left}px`;
      el.style.width = `${effectiveRect.width}px`;
      el.style.height = `${effectiveRect.height}px`;
    }
  }, [effectiveRect]);

  const ringPulse = reducedMotion ? "" : "motion-safe:animate-pulse";
  const dock = resolvePlacement(placement, effectiveRect, window.innerHeight);

  return (
    <div className={`fixed inset-0 pointer-events-none ${Z_TUTORIAL_OVERLAY_CLASS}`} data-testid="spotlight-overlay">
      {effectiveRect && (
        // Clip the ring and its 32px glow to below the status bar so nothing
        // orange ever paints behind the notch / Dynamic Island.
        <div className={SPOTLIGHT_CLIP_CLASS} data-testid="spotlight-clip">
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
        </div>
      )}

      {/* Bubble pinned to bottom-center, above the bottom nav. pointer-events-auto
          on the bubble itself so it's tappable; the surrounding layer stays
          transparent so the rest of the page is fully interactable. */}
      {dock === "top" ? (
        <div
          className="absolute inset-x-0 top-0 flex justify-center px-4 pt-safe pointer-events-none"
          data-coach-dock="top"
        >
          <div className="pointer-events-auto w-full max-w-md mt-16">{children}</div>
        </div>
      ) : (
        // `coach-dock-bottom` (index.css) lifts the bubble above the consent
        // banner while it is open: both are fixed to the bottom edge, and the
        // banner's measured inset is the only number they can share.
        <div
          className="coach-dock-bottom absolute inset-x-0 bottom-0 flex justify-center px-4 pb-safe pointer-events-none"
          data-coach-dock="bottom"
        >
          <div className="coach-dock-bubble pointer-events-auto w-full max-w-md mb-20 sm:mb-6">{children}</div>
        </div>
      )}
    </div>
  );
}
