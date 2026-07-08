import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { useAuthContext } from "./AuthContext";
import { useNavigationContext } from "./NavigationContext";
import { useNotifications } from "./NotificationContext";
import { updatePlayerStats, getUserProfile } from "../services/users";
import { isUserBlocked } from "../services/blocking";
import { createGame, forfeitExpiredTurn, subscribeToMyGames, subscribeToGame, type GameDoc } from "../services/games";
import { getOpponent } from "../services/games.turns";
import type { TrickCategoryId } from "../constants/trickCategories";
import { newGameShell, parseFirebaseError } from "../utils/helpers";
import { analytics } from "../services/analytics";
import { logger } from "../services/logger";

export interface StartChallengeOptions {
  spotId?: string | null;
  judgeUid?: string | null;
  judgeUsername?: string | null;
  trickCategory?: TrickCategoryId | null;
  customRules?: string | null;
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

  // One-shot guard for the stats fan-out (see fanOutStats below). Keys
  // `${gameId}:self` and `${gameId}:opp` isolate the owner and peer writes
  // so a rules-rejected peer write can't suppress the owner. Keys are
  // never cleared once set: clearing on catch would let onSnapshot
  // re-emissions hammer a doomed write. Any unrecorded stats catch up on
  // the next session — updatePlayerStats is idempotent per game via the
  // lastStatsGameId transaction check.
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

  // Fan out win/loss increments for one finished game — writes both the
  // caller's own stats (always permitted by isOwner) and the opponent's
  // (gated by canPeerCloseStats in firestore.rules). Guarded per-side by
  // processedStatsRef so re-emissions don't double-fire, and so a
  // permission-denied on one side can't gate the other. Shared by the
  // games-list catch-up loop and the single-game listener; the shared
  // ref keeps the two subscriptions from re-firing the same write.
  const fanOutStats = useCallback((game: GameDoc, selfUid: string): void => {
    if ((game.status !== "complete" && game.status !== "forfeit") || !game.winner) return;
    const selfKey = `${game.id}:self`;
    const oppKey = `${game.id}:opp`;
    const won = game.winner === selfUid;
    const opponentUid = getOpponent(game, selfUid);
    if (!processedStatsRef.current.has(selfKey)) {
      processedStatsRef.current.add(selfKey);
      updatePlayerStats(selfUid, game.id, won).catch((err) => {
        logger.warn("stats_write_failed", {
          gameId: game.id,
          side: "self",
          error: parseFirebaseError(err),
        });
      });
    }
    if (!processedStatsRef.current.has(oppKey)) {
      processedStatsRef.current.add(oppKey);
      updatePlayerStats(opponentUid, game.id, !won).catch((err) => {
        logger.warn("stats_write_failed", {
          gameId: game.id,
          side: "opp",
          error: parseFirebaseError(err),
        });
      });
    }
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

  // Sweep all expired turns in a games list. Extracted so the snapshot
  // handler and the deadline timer (below) share one code path. Safe to call
  // speculatively — forfeitExpiredTurn re-checks the deadline server-side.
  const sweepExpiredTurns = useCallback(
    (list: GameDoc[]) => {
      const now = Date.now();
      for (const g of list) {
        if (g.status !== "active" || forfeitAttemptedRef.current.has(g.id)) continue;
        const deadline = g.turnDeadline?.toMillis?.() ?? 0;
        if (deadline > 0 && deadline <= now) {
          forfeitAttemptedRef.current.add(g.id);
          // Pass the caller's uid so forfeitExpiredTurn can skip the
          // self-notify the /notifications rule forbids (see that fn's doc).
          forfeitExpiredTurn(g.id, user?.uid ?? null).catch((err) => {
            logger.warn("forfeit_expired_failed", {
              gameId: g.id,
              error: parseFirebaseError(err),
            });
            forfeitAttemptedRef.current.delete(g.id);
          });
        }
      }
    },
    [user],
  );

  // Subscribe to games list with pagination
  useEffect(() => {
    if (!user || !activeProfile) return;
    setGamesLoading(true);
    const unsub = subscribeToMyGames(
      user.uid,
      (updatedGames) => {
        setGames(updatedGames);
        setGamesLoading(false);
        // Catch up on stats for games that completed while the user was
        // away. Without the opponent-side write, an absent loser's `losses`
        // counter never advances and the leaderboard skews.
        for (const g of updatedGames) {
          fanOutStats(g, user.uid);
        }
        // Auto-resolve games whose turn deadline passed while nobody was
        // watching. Mirrors the per-game check in GamePlayScreen but runs
        // against the full list so stale "active" games don't linger in
        // the lobby counter. The transaction re-checks the deadline
        // server-side, so this is safe to fire for every expired game.
        sweepExpiredTurns(updatedGames);
      },
      gamesLimit,
    );
    return unsub;
  }, [user, activeProfile, gamesLimit, sweepExpiredTurns, fanOutStats]);

  // Schedule a sweep when the next visible deadline elapses. Without this,
  // a user who keeps the app open across an expiring deadline never sees
  // the forfeit fire — onSnapshot only triggers when a game DOC changes,
  // and an expiring deadline alone doesn't write to the doc. The transaction
  // in forfeitExpiredTurn re-checks the deadline server-side, so firing
  // slightly early (clock skew) is harmless.
  useEffect(() => {
    if (!user || !activeProfile) return;
    const now = Date.now();
    let earliest = Infinity;
    for (const g of games) {
      if (g.status !== "active" || forfeitAttemptedRef.current.has(g.id)) continue;
      const deadline = g.turnDeadline?.toMillis?.() ?? 0;
      if (deadline > now && deadline < earliest) earliest = deadline;
    }
    if (!Number.isFinite(earliest)) return;
    // Cap delay at 2³¹−1 ms (setTimeout limit); add a 1s buffer so the
    // server-side deadline check has comfortably elapsed when the sweep runs.
    const delay = Math.min(earliest - now + 1000, 2_147_483_647);
    const handle = setTimeout(() => sweepExpiredTurns(games), delay);
    return () => clearTimeout(handle);
  }, [games, user, activeProfile, sweepExpiredTurns]);

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
      // Live update path shares processedStatsRef with the games-list
      // catch-up, so a completion delivered via both subscriptions can't
      // double-fire.
      const currentUser = userRef.current;
      if (currentUser) fanOutStats(updated, currentUser.uid);
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
      const trickCategory = options?.trickCategory ?? null;
      const customRules = options?.customRules ?? null;
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
        trickCategory,
        customRules,
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
        trickCategory,
        customRules,
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
