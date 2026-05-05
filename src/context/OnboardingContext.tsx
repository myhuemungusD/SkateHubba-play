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
 */
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthContext();
  const onboarding = useOnboarding(user?.uid ?? null, TUTORIAL_TOTAL_STEPS);
  const reducedMotion = useReducedMotion();

  const value = useMemo<OnboardingContextValue>(() => ({ ...onboarding, reducedMotion }), [onboarding, reducedMotion]);

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}
