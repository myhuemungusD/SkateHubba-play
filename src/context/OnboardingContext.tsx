import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAuthContext } from "./AuthContext";
import { useNavigationContext } from "./NavigationContext";
import { useGameContext } from "./GameContext";
import { useOnboarding, type UseOnboardingReturn } from "../hooks/useOnboarding";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { TUTORIAL_STEPS, TUTORIAL_TOTAL_STEPS } from "../components/onboarding/tutorialSteps";

export interface OnboardingContextValue extends UseOnboardingReturn {
  reducedMotion: boolean;
  /**
   * Raw shouldShow from the underlying state machine — true when the tour
   * is armed regardless of whether the current screen matches. Tests rely
   * on this to assert the machine state independently of the screen-aware
   * `shouldShow` that consumers render against.
   */
  tourArmed: boolean;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

/**
 * Surface the onboarding state machine to every component below the provider.
 * Throws when used outside <OnboardingProvider> — same fail-loud pattern as
 * useAuthContext, so missing wrapping doesn't silently produce a no-op tour.
 */
export function useOnboardingContext(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboardingContext must be used within OnboardingProvider");
  return ctx;
}

/**
 * Hosts the tutorial state. Reads the auth uid from AuthContext so the tour
 * is automatically scoped per-user.
 *
 * Pause-don't-skip: the visible `shouldShow` is gated on the current screen
 * matching the active step's declared screen. If the user navigates away
 * mid-tour the overlay stops rendering but the underlying step state is
 * preserved — they pick back up where they left off when they return.
 *
 * The tour is also suppressed while a game is active (or the user is on the
 * gameplay/gameover screens) so it never overlays match-critical UI.
 */
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user, activeProfile } = useAuthContext();
  const { screen } = useNavigationContext();
  const { activeGame } = useGameContext();
  const uid = user && activeProfile ? user.uid : null;
  const onboarding = useOnboarding(uid, TUTORIAL_TOTAL_STEPS);
  const reducedMotion = useReducedMotion();

  const { loading, shouldShow: tourArmed, currentStep, totalSteps, advance, back, skip, complete, replay } = onboarding;

  // Compute the screen-aware shouldShow. A step with screen=null renders on
  // any signed-in screen; otherwise the step's declared screen must match
  // the current screen exactly. Gameplay screens always suppress the tour.
  const stepScreen = TUTORIAL_STEPS[currentStep]?.screen ?? null;
  const onGameplayScreen = screen === "game" || screen === "gameover";
  const screenMatches = stepScreen === null ? true : stepScreen === screen;
  const effectiveShouldShow = tourArmed && screenMatches && !activeGame && !onGameplayScreen;

  const value = useMemo<OnboardingContextValue>(
    () => ({
      loading,
      shouldShow: effectiveShouldShow,
      tourArmed,
      currentStep,
      totalSteps,
      advance,
      back,
      skip,
      complete,
      replay,
      reducedMotion,
    }),
    [
      loading,
      effectiveShouldShow,
      tourArmed,
      currentStep,
      totalSteps,
      advance,
      back,
      skip,
      complete,
      replay,
      reducedMotion,
    ],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}
