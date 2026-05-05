import { useEffect } from "react";
import { useOnboardingContext } from "../../context/OnboardingContext";
import { TUTORIAL_STEPS } from "./tutorialSteps";
import { MascotBubble } from "./MascotBubble";
import { SpotlightOverlay } from "./SpotlightOverlay";
import type { HubzState } from "./HubzMascot";

const CONFETTI = ["🤘", "🛹", "✨"] as const;

function mascotStateForStep(stepIndex: number, isFinal: boolean): HubzState {
  if (isFinal) return "cheer";
  if (stepIndex === 0) return "idle";
  return "talking";
}

/**
 * Top-level orchestrator for the non-blocking onboarding tour. Reads the
 * machine state out of OnboardingContext and renders nothing when the tour
 * is dismissed or still loading.
 *
 * Unlike a modal dialog, this overlay does NOT trap focus, set `inert`, or
 * mark itself `aria-modal` — the underlying app stays fully interactive
 * (Pokemon-Go-style coach mark). The bubble is exposed as a non-modal dialog
 * so screen readers still announce its label, and Esc still dismisses it as
 * a courtesy for keyboard users.
 */
export function TutorialOverlay() {
  const { loading, shouldShow, currentStep, totalSteps, advance, back, skip, complete, reducedMotion } =
    useOnboardingContext();

  const step = TUTORIAL_STEPS[currentStep];
  const isFinal = step?.isFinal === true;

  useEffect(() => {
    if (loading || !shouldShow) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void skip();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [loading, shouldShow, skip]);

  if (loading || !shouldShow || !step) return null;

  const onPrimary = () => {
    if (isFinal) {
      void complete();
    } else {
      advance();
    }
  };

  const stepLabel = `Step ${currentStep + 1} of ${totalSteps}`;
  const showBack = currentStep > 0;
  const showConfetti = isFinal && !reducedMotion;

  return (
    <div role="dialog" aria-labelledby="onboarding-title" data-testid="tutorial-overlay" className="contents">
      <SpotlightOverlay
        targetSelector={step.anchorSelector}
        reducedMotion={reducedMotion}
        onBackdropTap={() => void skip()}
      >
        <MascotBubble
          title={step.title}
          message={step.bubble}
          stepLabel={stepLabel}
          mascotState={mascotStateForStep(currentStep, isFinal)}
          primaryCta={{ label: step.primaryCtaLabel, onClick: onPrimary }}
          onSkip={() => void skip()}
          onBack={showBack ? back : undefined}
          reducedMotion={reducedMotion}
        />
      </SpotlightOverlay>

      {showConfetti && (
        <div
          aria-hidden="true"
          data-testid="tutorial-confetti"
          className="pointer-events-none fixed inset-x-0 bottom-44 flex justify-center gap-6 z-[60]"
        >
          {CONFETTI.map((emoji, i) => (
            <span key={emoji} className="text-3xl motion-safe:animate-float" style={{ animationDelay: `${i * 120}ms` }}>
              {emoji}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
