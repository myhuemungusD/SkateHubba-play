import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAuthContext } from "./AuthContext";
import { useOnboarding, type UseOnboardingReturn } from "../hooks/useOnboarding";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { TUTORIAL_TOTAL_STEPS } from "../components/onboarding/tutorialSteps";

export interface OnboardingContextValue extends UseOnboardingReturn {
  reducedMotion: boolean;
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
 * is automatically scoped per-user (signing out + signing back in as someone
 * else re-evaluates from their own persistence).
 *
 * Gated on `activeProfile` (not just `user`) so the tour cannot fire while a
 * brand-new signup is still on `/profile`. Without this gate, a skip or
 * complete mid-ProfileSetup would write onboarding fields to the
 * `users/{uid}/private/profile` doc, and the subsequent `createProfile`
 * transaction would wipe them via `tx.set(privateRef, privateData)` —
 * causing the tour to replay on the next sign-in. Every tutorial anchor
 * (`challenge-cta`, `record-button`) also lives on lobby/lower screens, so
 * gating on profile existence matches the actual UX flow.
 */
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user, activeProfile } = useAuthContext();
  const uid = user && activeProfile ? user.uid : null;
  const onboarding = useOnboarding(uid, TUTORIAL_TOTAL_STEPS);
  const reducedMotion = useReducedMotion();

  // useOnboarding returns a fresh object reference each render, so depending
  // on `onboarding` directly would defeat memoization. Spread the primitives
  // and stable callbacks so the memoized value is reused as long as the
  // underlying state hasn't changed.
  const { loading, shouldShow, currentStep, totalSteps, advance, back, skip, complete, replay } = onboarding;
  const value = useMemo<OnboardingContextValue>(
    () => ({ loading, shouldShow, currentStep, totalSteps, advance, back, skip, complete, replay, reducedMotion }),
    [loading, shouldShow, currentStep, totalSteps, advance, back, skip, complete, replay, reducedMotion],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}
