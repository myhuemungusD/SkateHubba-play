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

/**
 * Speech-bubble UI for a single tutorial step. Owns the visible step label
 * + aria-live announcement, the mascot illustration, and the three actions
 * (back/skip/primary). The outer dialog framing lives in TutorialOverlay so
 * this component can be unit-tested in isolation.
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
      className={`glass-card rounded-3xl px-6 pt-6 pb-safe max-w-md w-full ${enterAnim}`}
      data-testid="mascot-bubble"
    >
      <div className="flex items-start gap-4">
        <HubzMascot state={mascotState} className="w-20 h-20 shrink-0 text-brand-orange" />
        <div className="flex-1 min-w-0">
          <p className="font-body text-xs text-muted uppercase tracking-widest" aria-hidden="true">
            {stepLabel}
          </p>
          <h2 id="onboarding-title" className="font-display text-xl text-white tracking-wider mt-1">
            {title}
          </h2>
          <div className="mt-2" role="status" aria-live="polite">
            <span className="sr-only">{stepLabel}. </span>
            <p className="font-body text-sm text-bright leading-relaxed">{message}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-6 gap-3">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className={`touch-target inline-flex items-center font-body text-sm text-muted hover:text-white rounded-lg ${FOCUS_RING}`}
            >
              back
            </button>
          )}
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className={`touch-target inline-flex items-center font-body text-sm text-muted hover:text-white rounded-lg ${FOCUS_RING}`}
            >
              skip
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={primaryCta.onClick}
          autoFocus
          className={`touch-target inline-flex items-center font-display tracking-wider text-base text-white bg-brand-orange hover:brightness-110 active:brightness-95 rounded-xl px-5 ${FOCUS_RING}`}
        >
          {primaryCta.label}
        </button>
      </div>
    </div>
  );
}
