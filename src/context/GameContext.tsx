import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";
import { signOut as fbSignOut, signInWithGoogle, resolveGoogleRedirect } from "../services/auth";
import { createGame, subscribeToMyGames, subscribeToGame, type GameDoc } from "../services/games";
import type { UserProfile } from "../services/users";
import { newGameShell } from "../utils/helpers";
import { analytics } from "../services/analytics";

export type Screen = "landing" | "auth" | "profile" | "lobby" | "challenge" | "game" | "gameover";

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

  // Resolve any pending Google redirect on mount
  useEffect(() => {
    resolveGoogleRedirect().catch(() => {});
  }, []);

  const handleGoogleSignIn = useCallback(async () => {
    setGoogleError("");
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      analytics.signIn("google");
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? "";
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        // User dismissed
      } else if (code === "auth/account-exists-with-different-credential") {
        setGoogleError("This email is linked to a password account. Sign in with email/password instead.");
        if (screen !== "auth") {
          setAuthMode("signin");
          setScreen("auth");
        }
      } else {
        setGoogleError(err instanceof Error ? err.message : "Google sign-in failed");
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
    if (loading) return;
    if (!user) {
      setScreen("landing");
      return;
    }
    if (!activeProfile) {
      setScreen("profile");
      return;
    }
    setScreen((prev) => (prev === "landing" || prev === "auth" || prev === "profile" ? "lobby" : prev));
  }, [loading, user, activeProfile]);

  // Subscribe to games list
  useEffect(() => {
    if (!user || !activeProfile) return;
    const unsub = subscribeToMyGames(user.uid, setGames);
    return unsub;
  }, [user, activeProfile]);

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
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-subscribe only when game ID changes
  }, [activeGame?.id]);

  const handleSignOut = useCallback(async () => {
    await fbSignOut();
    setActiveProfile(null);
    setGames([]);
    setActiveGame(null);
    setAuthMode("signup");
    setScreen("landing");
  }, []);

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
      if (!user || !activeProfile) return;
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
    games,
    activeGame,
    setActiveGame,
    openGame,
    startChallenge,
    screen,
    setScreen,
    authMode,
    setAuthMode,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
