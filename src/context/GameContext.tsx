import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { useAuthContext } from "./AuthContext";
import { useNavigationContext } from "./NavigationContext";
import { useNotifications } from "./NotificationContext";
import { updatePlayerStats, getUserProfile } from "../services/users";
import { isUserBlocked } from "../services/blocking";
import { createGame, forfeitExpiredTurn, subscribeToMyGames, subscribeToGame, type GameDoc } from "../services/games";
import { newGameShell, parseFirebaseError } from "../utils/helpers";
import { analytics } from "../services/analytics";
import { logger } from "../services/logger";

export interface StartChallengeOptions {
  spotId?: string | null;
  judgeUid?: string | null;
  judgeUsername?: string | null;
}

export interface GameContextValue {
  games: GameDoc[];
  activeGame: GameDoc | null;
  setActiveGame: (g: GameDoc | null) => void;
  openGame: (g: GameDoc) => void;
  startChallenge: (opponentUid: string, opponentUsername: string, options?: StartChallengeOptions) => Promise<void>;
  hasMoreGames: boolean;
  loadMoreGames: () => void;
  gamesLoading: boolean;
}

const GameContext = createContext<GameContextValue | null>(null);

export function useGameContext(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGameContext must be used within GameProvider");
  return ctx;
}

/** How many games to load per page in the real-time subscription. */
const GAMES_PAGE_SIZE = 20;

export function GameProvider({ children }: { children: ReactNode }) {
  const { user, activeProfile } = useAuthContext();
  const { screen, setScreen } = useNavigationContext();
  const { notify } = useNotifications();

  const [games, setGames] = useState<GameDoc[]>([]);
  const [activeGame, setActiveGame] = useState<GameDoc | null>(null);

  // Track which games have already had stats recorded this session
  const processedStatsRef = useRef(new Set<string>());

  // Track which expired games have already had forfeit attempted this session,
  // so the subscription firing repeatedly (after any game update) doesn't spam
  // forfeitExpiredTurn for the same game.
  const forfeitAttemptedRef = useRef(new Set<string>());

  // Pagination state
  const [gamesLimit, setGamesLimit] = useState(GAMES_PAGE_SIZE);
  const [hasMoreGames, setHasMoreGames] = useState(false);
  const [gamesLoading, setGamesLoading] = useState(false);

  const loadMoreGames = useCallback(() => {
    setGamesLoading(true);
    setGamesLimit((prev) => prev + GAMES_PAGE_SIZE);
  }, []);

  // Clear game state when user logs out
  useEffect(() => {
    if (!user) {
      setGames([]);
      setActiveGame(null);
      processedStatsRef.current.clear();
      forfeitAttemptedRef.current.clear();
    }
  }, [user]);

  // Subscribe to games list with pagination
  useEffect(() => {
    if (!user || !activeProfile) return;
    setGamesLoading(true);
    const unsub = subscribeToMyGames(
      user.uid,
      (updatedGames) => {
        setGames(updatedGames);
        setGamesLoading(false);
        const now = Date.now();
        for (const g of updatedGames) {
          // Catch up on stats for games that completed while user was away
          if ((g.status === "complete" || g.status === "forfeit") && g.winner && !processedStatsRef.current.has(g.id)) {
            processedStatsRef.current.add(g.id);
            const won = g.winner === user.uid;
            updatePlayerStats(user.uid, g.id, won).catch((err) => {
              logger.warn("stats_catchup_failed", {
                gameId: g.id,
                error: parseFirebaseError(err),
              });
              processedStatsRef.current.delete(g.id);
            });
          }

          // Auto-resolve games whose turn deadline passed while nobody was
          // watching. Mirrors the per-game check in GamePlayScreen but runs
          // against the full list so stale "active" games don't linger in
          // the lobby counter. The transaction re-checks the deadline
          // server-side, so this is safe to fire for every expired game.
          if (g.status === "active" && !forfeitAttemptedRef.current.has(g.id)) {
            const deadline = g.turnDeadline?.toMillis?.() ?? 0;
            if (deadline > 0 && deadline <= now) {
              forfeitAttemptedRef.current.add(g.id);
              forfeitExpiredTurn(g.id).catch((err) => {
                logger.warn("forfeit_expired_failed", {
                  gameId: g.id,
                  error: parseFirebaseError(err),
                });
                forfeitAttemptedRef.current.delete(g.id);
              });
            }
          }
        }
      },
      gamesLimit,
    );
    return unsub;
  }, [user, activeProfile, gamesLimit]);

  // Track whether there are more games to load
  useEffect(() => {
    setHasMoreGames(games.length >= gamesLimit);
  }, [games.length, gamesLimit]);

  // Real-time single game subscription
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    if (!activeGame) return;
    const unsub = subscribeToGame(activeGame.id, (updated) => {
      if (!updated) return;
      setActiveGame(updated);
      if ((updated.status === "complete" || updated.status === "forfeit") && screenRef.current === "game") {
        setScreen("gameover");
      }
      // Update leaderboard stats when a game completes
      const currentUser = userRef.current;
      if (
        (updated.status === "complete" || updated.status === "forfeit") &&
        currentUser &&
        updated.winner &&
        !processedStatsRef.current.has(updated.id)
      ) {
        processedStatsRef.current.add(updated.id);
        const won = updated.winner === currentUser.uid;
        updatePlayerStats(currentUser.uid, updated.id, won).catch((err) => {
          logger.warn("stats_update_failed", {
            gameId: updated.id,
            error: parseFirebaseError(err),
          });
          processedStatsRef.current.delete(updated.id); // allow retry on next update
        });
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-subscribe only when game ID changes
  }, [activeGame?.id]);

  const openGame = useCallback(
    (g: GameDoc) => {
      setActiveGame(g);
      if (g.status === "complete" || g.status === "forfeit") {
        setScreen("gameover");
      } else {
        setScreen("game");
      }
    },
    [setScreen],
  );

  const startChallenge = useCallback(
    async (opponentUid: string, opponentUsername: string, options?: StartChallengeOptions) => {
      /* v8 ignore start -- null guard unreachable in tests; button disabled when user/profile is null */
      if (!user || !activeProfile) return;
      /* v8 ignore stop */
      const spotId = options?.spotId ?? null;
      const judgeUid = options?.judgeUid ?? null;
      const judgeUsername = options?.judgeUsername ?? null;
      // Defense-in-depth: check block status client-side (Firestore rules enforce server-side)
      const [blockedByMe, blockedByThem] = await Promise.all([
        isUserBlocked(user.uid, opponentUid),
        isUserBlocked(opponentUid, user.uid),
      ]);
      if (blockedByMe || blockedByThem) {
        throw new Error("Cannot challenge this player.");
      }
      const opponentProfile = await getUserProfile(opponentUid);
      const gameId = await createGame(user.uid, activeProfile.username, opponentUid, opponentUsername, {
        challengerIsVerifiedPro: activeProfile.isVerifiedPro,
        opponentIsVerifiedPro: opponentProfile?.isVerifiedPro,
        spotId,
        judgeUid,
        judgeUsername,
      });
      analytics.gameCreated(gameId);
      const shell = newGameShell(
        gameId,
        user.uid,
        activeProfile.username,
        opponentUid,
        opponentUsername,
        spotId,
        judgeUid,
        judgeUsername,
      );
      setActiveGame(shell);
      setScreen("game");
      // Success toast doubles as instruction: after setScreen() the user
      // lands on /game to set a trick — the toast confirms the challenge
      // took and nudges them toward the next step. Light haptic + chime
      // come from the notification provider's mapping.
      notify({
        type: "success",
        title: `Challenge sent to @${opponentUsername}`,
        message: "Record your trick to lock it in.",
        gameId,
      });
    },
    [user, activeProfile, setScreen, notify],
  );

  // Memoize the provider value so consumers don't re-render on every
  // GameProvider render (e.g. pagination effect toggling gamesLoading
  // would otherwise flush every useGameContext() consumer).
  const value = useMemo<GameContextValue>(
    () => ({
      games,
      activeGame,
      setActiveGame,
      openGame,
      startChallenge,
      hasMoreGames,
      loadMoreGames,
      gamesLoading,
    }),
    [games, activeGame, openGame, startChallenge, hasMoreGames, loadMoreGames, gamesLoading],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
