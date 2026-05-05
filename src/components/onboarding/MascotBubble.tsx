import { HubzMascot, type HubzState } from "./HubzMascot";

interface MascotBubbleProps {
  title: string;
  message: string;
  /** Visible label that the live region announces, e.g. "Step 2 of 5". */
  stepLabel: string;
  mascotState?: HubzState;
  primaryCta: { label: string; onClick: () => void };
  onSkip?: () => void;
  onBack?: () => void;
  /** Suppresses entrance / floating animations for users who prefer reduced motion. */
  reducedMotion: boolean;
}

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";
const TOUCH_TARGET = "min-h-10 min-w-10";

/**
 * Compact chat-style coach bubble: small mascot on the left, message on the
 * right, primary CTA + dismiss in a single tight row. Sized so it never
 * dominates the viewport — the user keeps seeing the underlying app while
 * the bubble speaks.
 *
 * The outer overlay (SpotlightOverlay) handles positioning & tap-outside
 * dismissal so this component can be unit-tested in isolation.
 */
export function MascotBubble({
  title,
  message,
  stepLabel,
  mascotState = "talking",
  primaryCta,
  onSkip,
  onBack,
  reducedMotion,
}: MascotBubbleProps) {
  const enterAnim = reducedMotion ? "" : "animate-scale-in";

  return (
    <div
      className={`glass-card rounded-2xl px-4 py-3 shadow-2xl ring-1 ring-brand-orange/20 ${enterAnim}`}
      data-testid="mascot-bubble"
    >
      <div className="flex items-start gap-3">
        <HubzMascot state={mascotState} className="w-12 h-12 shrink-0 text-brand-orange" />
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
      </div>

      <div className="flex items-center justify-end mt-3 gap-1">
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className={`font-body text-xs text-muted hover:text-white rounded-lg px-2 ${TOUCH_TARGET} ${FOCUS_RING}`}
          >
            skip
          </button>
        )}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className={`font-body text-xs text-muted hover:text-white rounded-lg px-2 ${TOUCH_TARGET} ${FOCUS_RING}`}
          >
            back
          </button>
        )}
        <button
          type="button"
          onClick={primaryCta.onClick}
          className={`font-display tracking-wider text-sm text-white bg-brand-orange hover:brightness-110 active:brightness-95 rounded-lg px-4 ${TOUCH_TARGET} ${FOCUS_RING}`}
        >
          {primaryCta.label}
        </button>
      </div>
    </div>
  );
}
