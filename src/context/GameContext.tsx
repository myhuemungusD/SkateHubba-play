import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";
import { signOut as fbSignOut, signInWithGoogle, resolveGoogleRedirect, deleteAccount } from "../services/auth";
import { deleteUserData, updatePlayerStats } from "../services/users";
import { createGame, subscribeToMyGames, subscribeToGame, type GameDoc } from "../services/games";
import type { UserProfile } from "../services/users";
import { newGameShell, getErrorCode, parseFirebaseError } from "../utils/helpers";
import { analytics } from "../services/analytics";
import { logger, metrics } from "../services/logger";
import { captureException } from "../lib/sentry";

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

interface GameContextValue {
  // Auth
  loading: boolean;
  user: ReturnType<typeof useAuth>["user"];
  profile: UserProfile | null;
  activeProfile: UserProfile | null;
  setActiveProfile: (p: UserProfile | null) => void;
  refreshProfile: () => Promise<void>;
  handleGoogleSignIn: () => Promise<void>;
  googleLoading: boolean;
  googleError: string;
  setGoogleError: (e: string) => void;
  handleSignOut: () => Promise<void>;
  handleDeleteAccount: () => Promise<void>;

  // Games
  games: GameDoc[];
  activeGame: GameDoc | null;
  setActiveGame: (g: GameDoc | null) => void;
  openGame: (g: GameDoc) => void;
  startChallenge: (opponentUid: string, opponentUsername: string) => Promise<void>;

  // Navigation
  screen: Screen;
  setScreen: (s: Screen) => void;
  authMode: "signup" | "signin";
  setAuthMode: (m: "signup" | "signin") => void;

  // Age gate
  ageGateDob: string | null;
  ageGateParentalConsent: boolean;
  setAgeGateResult: (dob: string, parentalConsent: boolean) => void;
}

const GameContext = createContext<GameContextValue | null>(null);

export function useGameContext(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGameContext must be used within GameProvider");
  return ctx;
}

export function GameProvider({ children }: { children: ReactNode }) {
  const { loading, user, profile, refreshProfile } = useAuth();

  const [screen, setScreen] = useState<Screen>("landing");
  const [games, setGames] = useState<GameDoc[]>([]);
  const [activeGame, setActiveGame] = useState<GameDoc | null>(null);
  const [activeProfile, setActiveProfile] = useState<UserProfile | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState("");
  const [authMode, setAuthMode] = useState<"signup" | "signin">("signup");
  const [ageGateDob, setAgeGateDob] = useState<string | null>(null);
  const [ageGateParentalConsent, setAgeGateParentalConsent] = useState(false);

  const setAgeGateResult = useCallback((dob: string, parentalConsent: boolean) => {
    setAgeGateDob(dob);
    setAgeGateParentalConsent(parentalConsent);
  }, []);

  // Resolve any pending Google redirect on mount — this completes the OAuth
  // flow for users who were redirected to Google (mobile/Safari popup fallback).
  // onAuthStateChanged handles the actual session, but we need to fire analytics
  // for redirect sign-ins since handleGoogleSignIn only tracks popup completions.
  useEffect(() => {
    resolveGoogleRedirect()
      .then((redirectUser) => {
        if (redirectUser) {
          logger.info("google_redirect_resolved", { uid: redirectUser.uid });
          analytics.signIn("google");
          metrics.signIn("google", redirectUser.uid);
        }
      })
      .catch((err) => {
        logger.warn("google_redirect_resolve_error", {
          message: err instanceof Error ? err.message : String(err),
        });
        captureException(err, { extra: { context: "resolveGoogleRedirect" } });
        // Surface the error to the user instead of silently swallowing it.
        // Navigate to the auth screen so the error banner is visible.
        setGoogleError("Google sign-in failed. Please try again.");
        setAuthMode("signin");
        setScreen("auth");
      });
  }, []);

  const handleGoogleSignIn = useCallback(async () => {
    setGoogleError("");
    setGoogleLoading(true);
    logger.info("google_sign_in_started");
    try {
      const googleUser = await signInWithGoogle();
      // Only track if sign-in completed (null = redirect initiated, not finished)
      if (googleUser) {
        logger.info("google_sign_in_completed", { uid: googleUser.uid });
        analytics.signIn("google");
        metrics.signIn("google", googleUser.uid);
      } else {
        logger.info("google_sign_in_redirect_initiated");
      }
    } catch (err: unknown) {
      const code = getErrorCode(err);
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        logger.info("google_sign_in_dismissed", { code });
      } else if (code === "auth/account-exists-with-different-credential") {
        logger.warn("google_sign_in_credential_conflict", { code });
        captureException(err, { extra: { context: "handleGoogleSignIn", code } });
        setGoogleError("This email is linked to a password account. Sign in with email/password instead.");
        if (screen !== "auth") {
          setAuthMode("signin");
          setScreen("auth");
        }
      } else if (code === "auth/too-many-requests") {
        logger.warn("google_sign_in_rate_limited", { code });
        setGoogleError("Too many attempts. Please wait a few minutes and try again.");
        if (screen !== "auth") {
          setAuthMode("signin");
          setScreen("auth");
        }
      } else if (code === "auth/unauthorized-domain") {
        logger.error("google_sign_in_unauthorized_domain", { code, origin: window.location.origin });
        captureException(err, { extra: { context: "handleGoogleSignIn", code, origin: window.location.origin } });
        setGoogleError(
          "This domain isn't authorized for Google sign-in. " +
            "Add it in Firebase Console → Authentication → Settings → Authorized domains.",
        );
        if (screen !== "auth") {
          setAuthMode("signin");
          setScreen("auth");
        }
      } else {
        logger.error("google_sign_in_error", { code, message: parseFirebaseError(err) });
        captureException(err, { extra: { context: "handleGoogleSignIn", code } });
        setGoogleError(err instanceof Error ? parseFirebaseError(err) : "Google sign-in failed");
        if (screen !== "auth") {
          setAuthMode("signin");
          setScreen("auth");
        }
      }
    } finally {
      setGoogleLoading(false);
    }
  }, [screen]);

  // Sync profile
  useEffect(() => {
    if (profile) setActiveProfile(profile);
  }, [profile]);

  // Route based on auth state
  useEffect(() => {
    if (loading) {
      logger.debug("auth_router_waiting", { loading: true });
      return;
    }
    if (!user) {
      logger.debug("auth_router_no_user", { target: "landing" });
      setScreen("landing");
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

  // Subscribe to games list
  useEffect(() => {
    if (!user || !activeProfile) return;
    const unsub = subscribeToMyGames(user.uid, (updatedGames) => {
      setGames(updatedGames);
      // Catch up on stats for games that completed while user was away
      for (const g of updatedGames) {
        if ((g.status === "complete" || g.status === "forfeit") && g.winner && !processedStatsRef.current.has(g.id)) {
          processedStatsRef.current.add(g.id);
          const won = g.winner === user.uid;
          updatePlayerStats(user.uid, g.id, won).catch((err) => {
            logger.warn("stats_catchup_failed", {
              gameId: g.id,
              error: err instanceof Error ? err.message : String(err),
            });
            processedStatsRef.current.delete(g.id);
          });
        }
      }
    });
    return unsub;
  }, [user, activeProfile]);

  // Track which games have already had stats recorded this session
  const processedStatsRef = useRef(new Set<string>());

  // Real-time single game subscription
  const screenRef = useRef(screen);
  screenRef.current = screen;

  useEffect(() => {
    if (!activeGame) return;
    const unsub = subscribeToGame(activeGame.id, (updated) => {
      if (!updated) return;
      setActiveGame(updated);
      if ((updated.status === "complete" || updated.status === "forfeit") && screenRef.current === "game") {
        setScreen("gameover");
      }
      // Update leaderboard stats when a game completes
      if (
        (updated.status === "complete" || updated.status === "forfeit") &&
        user &&
        updated.winner &&
        !processedStatsRef.current.has(updated.id)
      ) {
        processedStatsRef.current.add(updated.id);
        const won = updated.winner === user.uid;
        updatePlayerStats(user.uid, updated.id, won).catch((err) => {
          logger.warn("stats_update_failed", {
            gameId: updated.id,
            error: err instanceof Error ? err.message : String(err),
          });
          processedStatsRef.current.delete(updated.id); // allow retry on next update
        });
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-subscribe only when game ID changes
  }, [activeGame?.id]);

  const handleSignOut = useCallback(async () => {
    logger.info("user_sign_out");
    try {
      await fbSignOut();
    } catch (err) {
      logger.error("sign_out_error", { message: err instanceof Error ? err.message : String(err) });
    }
    setActiveProfile(null);
    setGames([]);
    setActiveGame(null);
    setAuthMode("signup");
    setScreen("landing");
  }, []);

  const handleDeleteAccount = useCallback(async () => {
    /* v8 ignore start */
    if (!activeProfile) return;
    /* v8 ignore stop */
    logger.info("delete_account_start", { uid: activeProfile.uid, username: activeProfile.username });
    // Delete Auth account first — if it fails (e.g. requires-recent-login),
    // Firestore data remains intact. This prevents orphaned Auth accounts
    // when Firestore cleanup succeeds but Auth deletion fails.
    try {
      await deleteAccount();
    } catch (err) {
      const code = getErrorCode(err);
      logger.error("delete_account_auth_failed", { uid: activeProfile.uid, code });
      if (code === "auth/requires-recent-login") {
        throw new Error("For security, please sign out and sign back in before deleting your account.", { cause: err });
      }
      throw err;
    }
    logger.info("delete_account_auth_done", { uid: activeProfile.uid });
    // Auth account is gone — clean up Firestore (best effort; no auth token
    // issues since Firestore SDK caches credentials briefly after deletion).
    try {
      await deleteUserData(activeProfile.uid, activeProfile.username);
      logger.info("delete_account_firestore_done", { uid: activeProfile.uid });
    } catch (firestoreErr) {
      // Auth is already deleted — Firestore data is orphaned.  Alert ops so
      // the username reservation + profile can be cleaned up manually.
      logger.error("delete_account_firestore_orphaned", {
        uid: activeProfile.uid,
        username: activeProfile.username,
        error: firestoreErr instanceof Error ? firestoreErr.message : String(firestoreErr),
      });
      captureException(firestoreErr, {
        extra: {
          context: "deleteUserData after auth deletion — data orphaned",
          uid: activeProfile.uid,
          username: activeProfile.username,
        },
      });
    }
    metrics.accountDeleted(activeProfile.uid);
    setActiveProfile(null);
    setGames([]);
    setActiveGame(null);
    setScreen("landing");
  }, [activeProfile]);

  const openGame = useCallback((g: GameDoc) => {
    setActiveGame(g);
    if (g.status === "complete" || g.status === "forfeit") {
      setScreen("gameover");
    } else {
      setScreen("game");
    }
  }, []);

  const startChallenge = useCallback(
    async (opponentUid: string, opponentUsername: string) => {
      /* v8 ignore start */
      if (!user || !activeProfile) return;
      /* v8 ignore stop */
      const gameId = await createGame(user.uid, activeProfile.username, opponentUid, opponentUsername);
      analytics.gameCreated(gameId);
      const shell = newGameShell(gameId, user.uid, activeProfile.username, opponentUid, opponentUsername);
      setActiveGame(shell);
      setScreen("game");
    },
    [user, activeProfile],
  );

  const value: GameContextValue = {
    loading,
    user,
    profile,
    activeProfile,
    setActiveProfile,
    refreshProfile,
    handleGoogleSignIn,
    googleLoading,
    googleError,
    setGoogleError,
    handleSignOut,
    handleDeleteAccount,
    games,
    activeGame,
    setActiveGame,
    openGame,
    startChallenge,
    screen,
    setScreen,
    authMode,
    setAuthMode,
    ageGateDob,
    ageGateParentalConsent,
    setAgeGateResult,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
