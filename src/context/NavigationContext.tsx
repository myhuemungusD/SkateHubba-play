import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useAuthContext } from "./AuthContext";
import { logger } from "../services/logger";

export type Screen =
  | "landing"
  | "agegate"
  | "auth"
  | "profile"
  | "lobby"
  | "challenge"
  | "game"
  | "gameover"
  | "record"
  | "privacy"
  | "terms"
  | "datadeletion"
  | "notfound";

export interface NavigationContextValue {
  screen: Screen;
  setScreen: (s: Screen) => void;
  authMode: "signup" | "signin";
  setAuthMode: (m: "signup" | "signin") => void;
  ageGateDob: string | null;
  ageGateParentalConsent: boolean;
  setAgeGateResult: (dob: string, parentalConsent: boolean) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function useNavigationContext(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error("useNavigationContext must be used within NavigationProvider");
  return ctx;
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const { loading, user, activeProfile, googleError } = useAuthContext();

  const [screen, setScreen] = useState<Screen>("landing");
  const [authMode, setAuthMode] = useState<"signup" | "signin">("signup");
  const [ageGateDob, setAgeGateDob] = useState<string | null>(null);
  const [ageGateParentalConsent, setAgeGateParentalConsent] = useState(false);

  const setAgeGateResult = useCallback((dob: string, parentalConsent: boolean) => {
    setAgeGateDob(dob);
    setAgeGateParentalConsent(parentalConsent);
  }, []);

  // Route based on auth state — this is intentionally synchronous within the
  // effect because the auth router must update the screen immediately when auth
  // state changes (e.g. sign-out → landing, profile created → lobby).
  /* eslint-disable react-hooks/set-state-in-effect -- auth routing requires synchronous screen transitions */
  useEffect(() => {
    if (loading) {
      logger.debug("auth_router_waiting", { loading: true });
      return;
    }
    if (!user) {
      logger.debug("auth_router_no_user", { target: "landing" });
      setScreen("landing");
      setAuthMode("signup");
      return;
    }
    if (!activeProfile) {
      logger.debug("auth_router_no_profile", { uid: user.uid, target: "profile" });
      setScreen("profile");
      return;
    }
    setScreen((prev) => {
      const next = prev === "landing" || prev === "auth" || prev === "profile" ? "lobby" : prev;
      logger.debug("auth_router_resolved", { uid: user.uid, username: activeProfile.username, from: prev, to: next });
      return next;
    });
  }, [loading, user, activeProfile]);

  // Navigate to auth screen when a Google error occurs (e.g. redirect failure)
  const prevGoogleErrorRef = useRef(googleError);
  useEffect(() => {
    if (googleError && googleError !== prevGoogleErrorRef.current && screen !== "auth") {
      setAuthMode("signin");
      setScreen("auth");
    }
    prevGoogleErrorRef.current = googleError;
  }, [googleError, screen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const value: NavigationContextValue = {
    screen,
    setScreen,
    authMode,
    setAuthMode,
    ageGateDob,
    ageGateParentalConsent,
    setAgeGateResult,
  };

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}
