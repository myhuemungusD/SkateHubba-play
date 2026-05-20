import { useCallback, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { useOnboardingContext } from "../../context/OnboardingContext";
import { TUTORIAL_STEPS } from "./tutorialSteps";
import { MascotBubble } from "./MascotBubble";
import { SpotlightOverlay } from "./SpotlightOverlay";
import { Z_TUTORIAL_OVERLAY } from "./constants";
import type { HubzState } from "./HubzMascot";

const CONFETTI = ["🤘", "🛹", "✨"] as const;

function mascotStateForStep(stepIndex: number, isFinal: boolean): HubzState {
  if (isFinal) return "cheer";
  if (stepIndex === 0) return "idle";
  return "talking";
}

/**
 * True when the focus target is something that should swallow text-entry
 * keyboard input (Enter/Space) — used to skip the tour-advance shortcut so
 * a user filling out a profile form isn't yanked into the next step on
 * their first space-bar press.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Top-level orchestrator for the non-blocking onboarding tour. Reads the
 * machine state out of OnboardingContext and renders nothing when the tour
 * is dismissed, paused (off-screen), or still loading.
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

  // Defense-in-depth bounds check: the hook clamps but a TUTORIAL_VERSION
  // bump that shrinks the step count could leave a stale persisted index
  // briefly out of range.
  const inRange = currentStep >= 0 && currentStep < TUTORIAL_STEPS.length;
  const step = inRange ? TUTORIAL_STEPS[currentStep] : undefined;
  const isFinal = step?.isFinal === true;

  useEffect(() => {
    if (loading || !shouldShow || !step) return;
    const handleKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target ?? document.activeElement)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        void skip();
        return;
      }
      // Enter / Space mirror the primary CTA. Final step routes to complete()
      // instead of advance() so the celebration fires on keyboard exit too.
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (isFinal) void complete();
        else advance();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [loading, shouldShow, step, isFinal, skip, advance, complete]);

  // Android hardware-back: gate on Capacitor.isNativePlatform() so the
  // listener never registers on web. We listen for `popstate` since the
  // Capacitor WebView translates the hardware Back gesture into a popstate
  // event by default — pushing a sentinel state lets us detect and absorb
  // the press instead of letting the WebView navigate away mid-tour. Push
  // exactly once per tour session, NOT per step, otherwise advancing through
  // the tour stacks history entries and the user has to press Back N times
  // before normal navigation resumes after dismissal.
  useEffect(() => {
    if (loading || !shouldShow) return;
    if (!Capacitor.isNativePlatform()) return;
    const SENTINEL = "tutorial-back";
    try {
      window.history.pushState({ [SENTINEL]: true }, "");
    } catch {
      /* sandboxed history APIs — best-effort */
    }
    const handler = (e: PopStateEvent) => {
      // Absorb the back press by skipping the tour. We don't push a fresh
      // sentinel afterwards so the next back press behaves normally.
      void skip();
      e.stopImmediatePropagation();
    };
    window.addEventListener("popstate", handler);
    return () => {
      window.removeEventListener("popstate", handler);
    };
  }, [loading, shouldShow, skip]);

  // Anchor-missing watchdog: if the step's selector never intersects the
  // viewport, silently advance one step instead of painting a ringless
  // bubble. The callback must be referentially stable — SpotlightOverlay
  // holds it in a useEffect dep array, so a fresh arrow on every render would
  // tear down and restart the IntersectionObserver + 1500ms watchdog timer,
  // and the auto-advance would never fire if the parent re-renders within
  // the window. Defined before the early return so the hook order stays
  // stable across renders.
  const advanceForMissingAnchor = useCallback(() => advance(), [advance]);

  if (loading || !shouldShow || !step) return null;

  const onPrimary = () => {
    if (isFinal) {
      void complete();
    } else {
      advance();
    }
  };

  // Final step has no anchor and never triggers the watchdog path.
  const onAnchorMissing = step.anchorSelector ? advanceForMissingAnchor : undefined;

  const stepLabel = `Step ${currentStep + 1} of ${totalSteps}`;
  const showBack = currentStep > 0;
  const showConfetti = isFinal && !reducedMotion;
  const showGhostLetter = isFinal && !reducedMotion;
  const stencilWipe = reducedMotion ? "" : "animate-stencil-wipe";

  // The dialog wrapper used to be `display: contents`, but some AT
  // combinations drop `display: contents` nodes from the accessibility tree —
  // which would silently strip the dialog role and label. Use a regular block
  // element instead. The children inside are all `position: fixed`, so this
  // wrapper has zero intrinsic layout impact, but it survives in the a11y
  // tree so screen readers reliably announce the coach mark as a dialog —
  // and the labelling MascotBubble (inside SpotlightOverlay) stays inside
  // the dialog subtree so aria-labelledby resolves correctly.
  return (
    <div role="dialog" aria-labelledby="onboarding-title" data-testid="tutorial-overlay">
      <SpotlightOverlay
        targetSelector={step.anchorSelector}
        reducedMotion={reducedMotion}
        onAnchorMissing={onAnchorMissing}
      >
        <div key={step.id} className={stencilWipe}>
          <MascotBubble
            title={step.title}
            message={step.bubble}
            stepLabel={stepLabel}
            stepIndex={currentStep}
            totalSteps={totalSteps}
            mascotState={mascotStateForStep(currentStep, isFinal)}
            primaryCta={{ label: step.primaryCtaLabel, onClick: onPrimary }}
            onSkip={() => void skip()}
            onBack={showBack ? back : undefined}
            onClose={() => void skip()}
            reducedMotion={reducedMotion}
          />
        </div>
      </SpotlightOverlay>

      {showConfetti && (
        <div
          aria-hidden="true"
          data-testid="tutorial-confetti"
          className="pointer-events-none fixed inset-x-0 bottom-44 flex justify-center gap-6"
          style={{ zIndex: Z_TUTORIAL_OVERLAY }}
        >
          {CONFETTI.map((emoji, i) => (
            <span key={emoji} className="text-3xl motion-safe:animate-float" style={{ animationDelay: `${i * 120}ms` }}>
              {emoji}
            </span>
          ))}
        </div>
      )}

      {showGhostLetter && (
        <div
          aria-hidden="true"
          data-testid="tutorial-ghost-letter"
          className="pointer-events-none fixed top-10 right-6 motion-safe:animate-graffiti-drip"
          style={{ zIndex: Z_TUTORIAL_OVERLAY }}
        >
          <span className="font-display text-7xl text-brand-orange opacity-90 select-none">S</span>
        </div>
      )}
    </div>
  );
}
