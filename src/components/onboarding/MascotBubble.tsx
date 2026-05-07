import { useId } from "react";
import { HubzMascot, type HubzState } from "./HubzMascot";
import { playHaptic } from "../../services/haptics";

interface MascotBubbleProps {
  title: string;
  message: string;
  /** Visible label that the live region announces, e.g. "Step 2 of 5". */
  stepLabel: string;
  /** 1-indexed step position used to render the grip-tape progress strip. */
  stepIndex: number;
  /** Total number of steps; pairs with {@link stepIndex} for the strip. */
  totalSteps: number;
  mascotState?: HubzState;
  primaryCta: { label: string; onClick: () => void };
  onSkip?: () => void;
  onBack?: () => void;
  /** Explicit close affordance — surfaced as a small "x" in the top-right. */
  onClose?: () => void;
  /** Suppresses entrance / floating animations for users who prefer reduced motion. */
  reducedMotion: boolean;
}

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";
// Apple HIG mandates 44pt minimum tap targets — keep the buttons hit-friendly
// even though the visual chrome is compact.
const TOUCH_TARGET = "min-h-11 min-w-11";

/**
 * Compact chat-style coach bubble: small mascot on the left, message on the
 * right, primary CTA + dismiss in a single tight row. Sized so it never
 * dominates the viewport — the user keeps seeing the underlying app while
 * the bubble speaks.
 *
 * Dismissal is owned by the bubble itself (close "x", skip, back) so the
 * surrounding overlay can stay non-interactive everywhere else — the previous
 * document-level click-to-dismiss leaked into legitimate interactions and
 * was easy to fire by accident.
 */
export function MascotBubble({
  title,
  message,
  stepLabel,
  stepIndex,
  totalSteps,
  mascotState = "talking",
  primaryCta,
  onSkip,
  onBack,
  onClose,
  reducedMotion,
}: MascotBubbleProps) {
  // useId scopes the SVG filter id per component instance so two MascotBubble
  // siblings can't shadow each other's filter via the document-global id space.
  const filterId = useId();
  const enterAnim = reducedMotion ? "" : "animate-scale-in";

  const handlePrimary = () => {
    playHaptic("button_primary");
    primaryCta.onClick();
  };
  const handleBack = onBack
    ? () => {
        playHaptic("button_primary");
        onBack();
      }
    : undefined;
  const handleSkip = onSkip
    ? () => {
        playHaptic("button_primary");
        onSkip();
      }
    : undefined;
  const handleClose = onClose
    ? () => {
        playHaptic("button_primary");
        onClose();
      }
    : undefined;

  // Grip-tape progress strip. The "worn" portion to the left mirrors how far
  // through the tour the user is — clamped to (0, 1] so the first step still
  // shows a sliver of grip rather than rendering as completely fresh.
  const wornPct = Math.max(0, Math.min(100, ((stepIndex + 1) / Math.max(totalSteps, 1)) * 100));

  return (
    <div
      className={`glass-card rounded-2xl px-4 py-3 shadow-2xl ring-1 ring-brand-orange/20 ${enterAnim}`}
      data-testid="mascot-bubble"
      // Runtime hook (separate from the test id) used by SpotlightOverlay's
      // backdrop-tap detection so a future build plugin that strips test ids
      // can't break dismissal behavior.
      data-coach-bubble=""
    >
      <div className="flex items-start gap-3">
        <HubzMascot state={mascotState} className="w-12 h-12 shrink-0 text-brand-orange" decorative />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="onboarding-title" className="font-display text-base text-white tracking-wide">
              {title}
            </h2>
            <p className="font-body text-[10px] text-muted uppercase tracking-widest" aria-hidden="true">
              {stepLabel}
            </p>
          </div>
          <div className="mt-0.5" role="status" aria-live="polite">
            <span className="sr-only">{stepLabel}. </span>
            <p className="font-body text-sm text-bright leading-snug">{message}</p>
          </div>
        </div>
        {handleClose && (
          <button
            type="button"
            onClick={handleClose}
            aria-label="close tour"
            className={`-mt-1 -mr-1 text-muted hover:text-white rounded-full ${TOUCH_TARGET} ${FOCUS_RING}`}
          >
            <span aria-hidden="true" className="font-display text-lg leading-none">
              ×
            </span>
          </button>
        )}
      </div>

      {/* Grip-tape progress strip — replaces the dot indicator. The worn
          portion uses a noisy gradient to evoke roughed-up grip; the fresh
          portion stays matte black. Inline SVG noise pattern keeps the strip
          self-contained without touching tailwind.config or assets. */}
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={totalSteps}
        aria-valuenow={stepIndex + 1}
        aria-label={stepLabel}
        data-testid="grip-tape-strip"
        className="relative mt-2 h-2 rounded-full overflow-hidden bg-[#0d0d0d]"
      >
        <svg className="absolute inset-0 w-full h-full opacity-60" aria-hidden="true">
          <filter id={filterId} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
            <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.7 0" />
          </filter>
          <rect width="100%" height="100%" filter={`url(#${filterId})`} />
        </svg>
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-brand-orange/80 to-brand-orange"
          style={{ width: `${wornPct}%` }}
        />
      </div>

      <div className="flex items-center justify-end mt-3 gap-1">
        {handleSkip && (
          <button
            type="button"
            onClick={handleSkip}
            className={`font-body text-xs text-muted hover:text-white active:text-white active:bg-white/5 rounded-lg px-2 ${TOUCH_TARGET} ${FOCUS_RING}`}
          >
            skip
          </button>
        )}
        {handleBack && (
          <button
            type="button"
            onClick={handleBack}
            className={`font-body text-xs text-muted hover:text-white active:text-white active:bg-white/5 rounded-lg px-2 ${TOUCH_TARGET} ${FOCUS_RING}`}
          >
            back
          </button>
        )}
        <button
          type="button"
          onClick={handlePrimary}
          className={`font-display tracking-wider text-sm text-white bg-brand-orange hover:brightness-110 active:brightness-95 rounded-lg px-4 ${TOUCH_TARGET} ${FOCUS_RING}`}
        >
          {primaryCta.label}
        </button>
      </div>
    </div>
  );
}
