import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuthContext } from "./AuthContext";
import { logger } from "../services/logger";

/**
 * SessionStorage key used to carry a pending challenge spotId through the
 * auth bounce. Flow:
 *   1. Unauthenticated user opens /challenge?spot=<uuid> (shared link)
 *   2. Auth router bounces them to /landing for sign-in
 *   3. Before the bounce, the spot param is stashed here
 *   4. After login, the router lands them on /lobby
 *   5. On the lobby transition we consume the stash and redirect to
 *      /challenge?spot=<uuid>, restoring the full context
 *
 * Without this the query string is discarded by the bounce and the shared
 * link is effectively broken for logged-out recipients.
 */
const PENDING_SPOT_KEY = "skate.pendingChallengeSpot";
const SPOT_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // Handle dynamic /player/:uid route
  if (pathname.startsWith("/player/")) return "player";
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
  "map",
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
      // "player" is only a valid *current* screen (identified by the dynamic
      // /player/:uid URL). It has no static destination — callers must use
      // navigateToPlayer(uid) so the uid segment is present. Fail loud here
      // instead of silently 404'ing on /player (the bare path isn't routed).
      if (s === "player") {
        throw new Error("setScreen('player') is not supported — use navigateToPlayer(uid) instead");
      }
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
      // Stash a /challenge?spot=<uuid> param before the bounce so we can
      // restore it after the user authenticates. See PENDING_SPOT_KEY docs.
      if (currentScreen === "challenge") {
        const spot = new URLSearchParams(location.search).get("spot");
        if (spot && SPOT_ID_SHAPE.test(spot)) {
          try {
            sessionStorage.setItem(PENDING_SPOT_KEY, spot);
          } catch {
            // Private-mode Safari can throw — best-effort persistence only.
          }
        }
      }
      logger.debug("auth_router_no_user", { target: "landing" });
      // Use replace so Back doesn't loop the user back to the gated screen
      // they just tried to reach (e.g. /lobby → /landing → Back → /lobby
      // → bounce again). Router bounces aren't navigation history.
      navigate(SCREEN_TO_PATH.landing, { replace: true });
      setAuthMode("signup");
      return;
    }
    if (!activeProfile) {
      logger.debug("auth_router_no_profile", { uid: user.uid, target: "profile" });
      navigate(SCREEN_TO_PATH.profile, { replace: true });
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
    // If we're about to land the freshly-authenticated user on /lobby and
    // we have a pending challenge spot stashed from a pre-auth shared link,
    // consume it and redirect to /challenge?spot=<uuid> instead.
    if (next === "lobby") {
      let pending: string | null = null;
      try {
        pending = sessionStorage.getItem(PENDING_SPOT_KEY);
        if (pending) sessionStorage.removeItem(PENDING_SPOT_KEY);
      } catch {
        // Best-effort read; private mode, disabled storage, etc.
      }
      if (pending && SPOT_ID_SHAPE.test(pending)) {
        logger.debug("auth_router_restored_pending_spot", { uid: user.uid, spot: pending });
        navigate(`/challenge?spot=${pending}`, { replace: true });
        return;
      }
    }
    if (next !== currentScreen) {
      // Auth-router transitions (landing/auth/profile → lobby, etc.) are
      // not user navigation — use replace so Back skips the transient
      // screen and lands the user on the previous page instead of
      // re-triggering the bounce.
      navigate(SCREEN_TO_PATH[next], { replace: true });
    }
  }, [loading, user, activeProfile, location.pathname, location.search, navigate]);

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
    authMode,
    setAuthMode,
    ageGateDob,
    ageGateParentalConsent,
    setAgeGateResult,
  };

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}
