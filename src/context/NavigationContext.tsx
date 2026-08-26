import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router";
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
const PENDING_CHALLENGE_SPOT_KEY = "skate.pendingChallengeSpot";
/**
 * Same mechanism for a shared /spots/<uuid> link, kept under its own key.
 * The two restore to *different* destinations (/challenge?spot= vs
 * /spots/<id>), so overloading one key would silently land the recipient on
 * the wrong screen.
 */
const PENDING_SPOT_DETAIL_KEY = "skate.pendingSpotDetail";
const SPOT_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SPOT_DETAIL_PREFIX = "/spots/";

/**
 * Consume both pending deep-link stashes and return the path to restore, or
 * null when nothing is pending. Both keys are cleared on every call so a
 * stale stash from an abandoned bounce can't leak into a later sign-in.
 * The challenge link wins if both are somehow present.
 */
function takePendingDeepLink(): string | null {
  let challengeSpot: string | null = null;
  let spotDetail: string | null = null;
  try {
    challengeSpot = sessionStorage.getItem(PENDING_CHALLENGE_SPOT_KEY);
    spotDetail = sessionStorage.getItem(PENDING_SPOT_DETAIL_KEY);
    if (challengeSpot) sessionStorage.removeItem(PENDING_CHALLENGE_SPOT_KEY);
    if (spotDetail) sessionStorage.removeItem(PENDING_SPOT_DETAIL_KEY);
  } catch {
    // Best-effort read; private mode, disabled storage, etc.
  }
  if (challengeSpot && SPOT_ID_SHAPE.test(challengeSpot)) return `/challenge?spot=${challengeSpot}`;
  if (spotDetail && SPOT_ID_SHAPE.test(spotDetail)) return `${SPOT_DETAIL_PREFIX}${spotDetail}`;
  return null;
}

export type Screen =
  | "landing"
  | "auth"
  | "profile"
  | "lobby"
  | "challenge"
  | "game"
  | "gameover"
  | "me"
  | "feed"
  | "player"
  | "map"
  | "spotdetail"
  | "privacy"
  | "terms"
  | "datadeletion"
  | "notfound";

/** Map screen names to URL paths. */
const SCREEN_TO_PATH: Record<Screen, string> = {
  landing: "/",
  auth: "/auth",
  profile: "/profile",
  lobby: "/lobby",
  challenge: "/challenge",
  game: "/game",
  gameover: "/gameover",
  me: "/me",
  feed: "/feed",
  player: "/player",
  map: "/map",
  spotdetail: "/spots",
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
  // Handle dynamic /spots/:id route
  if (pathname.startsWith(SPOT_DETAIL_PREFIX)) return "spotdetail";
  return PATH_TO_SCREEN[pathname] ?? "notfound";
}

export function screenToPath(screen: Screen): string {
  return SCREEN_TO_PATH[screen];
}

/**
 * Screens that don't require authentication.
 *
 * "player" is public because `/player/:uid` is the app's share surface — a
 * profile link handed to someone without an account has to open, or it can
 * never bring them in. `users/{uid}` is publicly `get`-able, so the shareable
 * content (avatar, username, stance, verified-pro, stat tiles) renders
 * without a session; everything that needs an identity (challenge, block,
 * game history) is withheld by PlayerProfileScreen. Guarding this in one
 * place isn't enough — the `/player/:uid` route guard in App.tsx has to allow
 * the signed-out render too, or the two mechanisms fight.
 */
const PUBLIC_SCREENS: ReadonlySet<Screen> = new Set([
  "landing",
  "auth",
  "map",
  "player",
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
  /**
   * Navigate to the challenge screen with a spot pre-attached via the
   * `?spot=<uuid>` query param — the contract ChallengeScreen reads, and
   * what the auth router stashes/restores across sign-in. Exists because
   * `setScreen('challenge')` only routes to `/challenge` and strips the
   * query string, so spot-detail → challenge needs a typed helper instead
   * of a raw `navigate()` call.
   */
  navigateToChallengeWithSpot: (spotId: string) => void;
  /**
   * Navigate to the map with the Add Spot sheet already open, via the
   * `?add=1` query param MapPage reads. Exists for the same reason as
   * `navigateToChallengeWithSpot`: `setScreen('map')` only routes to `/map`,
   * and the sheet's open/closed state is local to SpotMap with no other
   * external entry point — so the profile's "ADD A SPOT" CTA would otherwise
   * dump the user on a bare map and make them find the FAB themselves.
   * MapPage consumes and clears the param on mount so a refresh or a Back
   * navigation doesn't reopen the sheet.
   */
  navigateToMapWithAddSpot: () => void;
  authMode: "signup" | "signin";
  setAuthMode: (m: "signup" | "signin") => void;
  ageGateDob: string | null;
  ageGateParentalConsent: boolean;
  setAgeGateResult: (dob: string, parentalConsent: boolean) => void;
  /** Reset the age-gate context. Called when a signUp attempt fails so the
   *  DOB doesn't leak across the failed-signup boundary into a subsequent
   *  sign-in with an existing account. */
  clearAgeGate: () => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function useNavigationContext(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error("useNavigationContext must be used within NavigationProvider");
  return ctx;
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const { loading, user, activeProfile, googleError, mfaChallenge } = useAuthContext();
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
      // Same story for "spotdetail" (/spots/:id): the bare /spots path isn't
      // routed, so dispatching to it would fall through to the 404 catch-all.
      if (s === "spotdetail") {
        throw new Error("setScreen('spotdetail') is not supported — navigate to /spots/<id> instead");
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

  const navigateToChallengeWithSpot = useCallback(
    (spotId: string) => {
      if (!SPOT_ID_SHAPE.test(spotId)) return;
      navigate(`/challenge?spot=${spotId}`);
    },
    [navigate],
  );

  const navigateToMapWithAddSpot = useCallback(() => {
    navigate(`${SCREEN_TO_PATH.map}?add=1`);
  }, [navigate]);

  const [authMode, setAuthMode] = useState<"signup" | "signin">("signup");
  const [ageGateDob, setAgeGateDob] = useState<string | null>(null);
  const [ageGateParentalConsent, setAgeGateParentalConsent] = useState(false);

  const setAgeGateResult = useCallback((dob: string, parentalConsent: boolean) => {
    setAgeGateDob(dob);
    setAgeGateParentalConsent(parentalConsent);
  }, []);

  const clearAgeGate = useCallback(() => {
    setAgeGateDob(null);
    setAgeGateParentalConsent(false);
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
      // restore it after the user authenticates. See the key docs above.
      if (currentScreen === "challenge") {
        const spot = new URLSearchParams(location.search).get("spot");
        if (spot && SPOT_ID_SHAPE.test(spot)) {
          try {
            sessionStorage.setItem(PENDING_CHALLENGE_SPOT_KEY, spot);
          } catch {
            // Private-mode Safari can throw — best-effort persistence only.
          }
        }
      }
      // Same for a shared /spots/<uuid> link — the id lives in the path
      // rather than the query, and restores to the spot page, not /challenge.
      if (currentScreen === "spotdetail") {
        const spotId = location.pathname.slice(SPOT_DETAIL_PREFIX.length);
        if (SPOT_ID_SHAPE.test(spotId)) {
          try {
            sessionStorage.setItem(PENDING_SPOT_DETAIL_KEY, spotId);
          } catch {
            // Private-mode Safari can throw — best-effort persistence only.
          }
        }
      }
      logger.debug("auth_router_no_user", { target: "landing" });
      // Use replace so Back doesn't loop the user back to the gated screen
      // they just tried to reach (e.g. /lobby → /landing → Back → /lobby →
      // bounce again). Auth-router bounces aren't navigation history.
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
    // If we're about to land the freshly-authenticated user on /lobby and a
    // pre-auth shared link was stashed on the bounce, consume it and redirect
    // to the original destination instead.
    if (next === "lobby") {
      const pendingPath = takePendingDeepLink();
      if (pendingPath) {
        logger.debug("auth_router_restored_pending_spot", { uid: user.uid, to: pendingPath });
        navigate(pendingPath, { replace: true });
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

  // Same mechanism for a captured second-factor challenge. AuthScreen is the
  // only renderer of the verification card, but Google sign-in also starts from
  // Landing (and a redirect resolves on "/"), so a challenge captured off /auth
  // used to leave the user staring at the landing page with a pending session
  // and no way to finish — a silent dead end.
  const prevMfaChallengeRef = useRef(mfaChallenge);
  useEffect(() => {
    if (mfaChallenge && mfaChallenge !== prevMfaChallengeRef.current && screen !== "auth") {
      setAuthMode("signin");
      setScreen("auth");
    }
    prevMfaChallengeRef.current = mfaChallenge;
  }, [mfaChallenge, screen, setScreen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const value: NavigationContextValue = {
    screen,
    setScreen,
    navigateToPlayer,
    navigateToChallengeWithSpot,
    navigateToMapWithAddSpot,
    authMode,
    setAuthMode,
    ageGateDob,
    ageGateParentalConsent,
    setAgeGateResult,
    clearAgeGate,
  };

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}
