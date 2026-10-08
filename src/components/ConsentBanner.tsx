import { useEffect, useRef, useState, type RefObject } from "react";
import { readConsent, writeConsent } from "../lib/consent";

/** Class set on <html> while the banner is on screen (see index.css). */
export const CONSENT_BANNER_OPEN_CLASS = "consent-banner-open";
/** CSS custom property carrying the banner's measured height in px. */
export const CONSENT_BANNER_SPACE_VAR = "--consent-banner-space";

/**
 * While the fixed banner is visible, reserve matching space at the bottom of
 * the document so it can never sit on top of a screen's last actions (e.g.
 * the "Create Account" button on /auth at 390px). The banner publishes its
 * live height as a CSS variable + an <html> class; index.css turns that into
 * body padding. Purely presentational — consent state is untouched.
 */
function useReserveBottomSpace(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const root = document.documentElement;
    const publish = () => {
      root.style.setProperty(CONSENT_BANNER_SPACE_VAR, `${Math.ceil(el.getBoundingClientRect().height)}px`);
    };
    publish();
    root.classList.add(CONSENT_BANNER_OPEN_CLASS);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.classList.remove(CONSENT_BANNER_OPEN_CLASS);
      root.style.removeProperty(CONSENT_BANNER_SPACE_VAR);
    };
  }, [ref, active]);
}

export function ConsentBanner({ onNav }: { onNav: (screen: "privacy" | "terms") => void }) {
  // Initialise synchronously from localStorage so the banner never flickers
  // in on a second render (avoids calling setState inside an effect).
  const [visible, setVisible] = useState(() => !readConsent());
  const regionRef = useRef<HTMLDivElement>(null);
  useReserveBottomSpace(regionRef, visible);

  const accept = () => {
    writeConsent("accepted");
    setVisible(false);
  };

  const decline = () => {
    writeConsent("declined");
    setVisible(false);
  };

  if (!visible) return null;

  // Compact on phones (tighter margin/padding) so it eats as little of the
  // viewport as possible; roomier from `sm` up.
  return (
    <div
      ref={regionRef}
      role="region"
      aria-label="Cookie and analytics notice"
      className="fixed bottom-0 left-0 right-0 z-50 max-h-[20dvh] overflow-y-auto px-3 pb-safe sm:px-4"
    >
      <div className="max-w-lg mx-auto mb-1 overflow-y-auto rounded-2xl glass-card px-3 py-2 shadow-glass animate-scale-in sm:mb-4 sm:px-4 sm:py-3 [@media(max-height:500px)]:mb-0 [@media(max-height:500px)]:py-1.5">
        <div className="flex items-center gap-3">
          <p className="font-body text-xs text-[#c8c8c8] leading-snug flex-1">
            Cookie-free analytics.{" "}
            <button
              type="button"
              onClick={() => onNav("privacy")}
              className="text-brand-orange underline underline-offset-2"
            >
              Privacy&nbsp;Policy
            </button>
          </p>
          <div className="flex gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={accept}
              className="touch-target inline-flex items-center justify-center px-4 py-1.5 rounded-xl bg-gradient-to-r from-brand-orange to-[#FF8533] font-display text-xs text-white tracking-wider hover:shadow-glow-sm active:scale-[0.97] transition-all duration-300 ring-1 ring-white/[0.08]"
            >
              OK
            </button>
            <button
              type="button"
              onClick={decline}
              className="touch-target inline-flex items-center justify-center px-3 py-1.5 rounded-xl border border-border font-body text-xs text-subtle hover:text-muted hover:border-border-hover transition-all duration-300"
            >
              No
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
