import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
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
  | "player"
  | "map"
  | "spot"
  | "privacy"
  | "terms"
  | "datadeletion"
  | "notfound";

/** Map screen names to URL paths. */
const SCREEN_TO_PATH: Record<Screen, string> = {
  landing: "/",
  agegate: "/age-gate",
  auth: "/auth",
  profile: "/profile",
  lobby: "/lobby",
  challenge: "/challenge",
  game: "/game",
  gameover: "/gameover",
  record: "/record",
  player: "/player",
  map: "/map",
  spot: "/spot",
  privacy: "/privacy",
  terms: "/terms",
  datadeletion: "/data-deletion",
  notfound: "/404",
};

/** Map URL paths back to screen names. */
const PATH_TO_SCREEN: Record<string, Screen> = Object.fromEntries(
  Object.entries(SCREEN_TO_PATH).map(([s, p]) => [p, s as Screen]),
) as Record<string, Screen>;

export function pathToScreen(pathname: string): Screen {
  // Handle dynamic routes
  if (pathname.startsWith("/player/")) return "player";
  if (pathname.startsWith("/spot/")) return "spot";
  return PATH_TO_SCREEN[pathname] ?? "notfound";
}

export function screenToPath(screen: Screen): string {
  return SCREEN_TO_PATH[screen];
}

/** Screens that don't require authentication. */
const PUBLIC_SCREENS: ReadonlySet<Screen> = new Set([
  "landing",
  "agegate",
  "auth",
  "privacy",
  "terms",
  "datadeletion",
  "notfound",
]);

export interface NavigationContextValue {
  screen: Screen;
  setScreen: (s: Screen) => void;
  /** Navigate to a player's public profile page. */
  navigateToPlayer: (uid: string) => void;
  /** Navigate to a spot detail page. */
  navigateToSpot: (spotId: string) => void;
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
  const navigate = useNavigate();
  const location = useLocation();

  const screen = pathToScreen(location.pathname);

  const setScreen = useCallback(
    (s: Screen) => {
      const path = screenToPath(s);
      navigate(path);
    },
    [navigate],
  );

  const navigateToPlayer = useCallback(
    (uid: string) => {
      navigate(`/player/${uid}`);
    },
    [navigate],
  );

  const navigateToSpot = useCallback(
    (spotId: string) => {
      navigate(`/spot/${spotId}`);
    },
    [navigate],
  );

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
    const currentScreen = pathToScreen(location.pathname);
    if (!user) {
      if (PUBLIC_SCREENS.has(currentScreen)) {
        logger.debug("auth_router_public_screen", { screen: currentScreen });
        return;
      }
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
    const next =
      currentScreen === "landing" || currentScreen === "auth" || currentScreen === "profile" ? "lobby" : currentScreen;
    logger.debug("auth_router_resolved", {
      uid: user.uid,
      username: activeProfile.username,
      from: currentScreen,
      to: next,
    });
    if (next !== currentScreen) {
      setScreen(next);
    }
  }, [loading, user, activeProfile, setScreen, location.pathname]);

  // Navigate to auth screen when a Google error occurs (e.g. redirect failure)
  const prevGoogleErrorRef = useRef(googleError);
  useEffect(() => {
    if (googleError && googleError !== prevGoogleErrorRef.current && screen !== "auth") {
      setAuthMode("signin");
      setScreen("auth");
    }
    prevGoogleErrorRef.current = googleError;
  }, [googleError, screen, setScreen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const value: NavigationContextValue = {
    screen,
    setScreen,
    navigateToPlayer,
    navigateToSpot,
    authMode,
    setAuthMode,
    ageGateDob,
    ageGateParentalConsent,
    setAgeGateResult,
  };

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}
