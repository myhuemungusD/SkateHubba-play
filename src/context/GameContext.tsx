import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useAuthContext } from "./AuthContext";
import { useNavigationContext } from "./NavigationContext";
import { updatePlayerStats } from "../services/users";
import { createGame, subscribeToMyGames, subscribeToGame, type GameDoc } from "../services/games";
import { newGameShell } from "../utils/helpers";
import { analytics } from "../services/analytics";
import { logger } from "../services/logger";

export interface GameContextValue {
  games: GameDoc[];
  activeGame: GameDoc | null;
  setActiveGame: (g: GameDoc | null) => void;
  openGame: (g: GameDoc) => void;
  startChallenge: (opponentUid: string, opponentUsername: string) => Promise<void>;
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

  const [games, setGames] = useState<GameDoc[]>([]);
  const [activeGame, setActiveGame] = useState<GameDoc | null>(null);

  // Track which games have already had stats recorded this session
  const processedStatsRef = useRef(new Set<string>());

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
    [user, activeProfile, setScreen],
  );

  const value: GameContextValue = {
    games,
    activeGame,
    setActiveGame,
    openGame,
    startChallenge,
    hasMoreGames,
    loadMoreGames,
    gamesLoading,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
