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

  // Track which stats writes have been attempted this session.
  // Keys are `${gameId}:self` and `${gameId}:opp` so the self and opponent
  // writes are guarded independently — one side being blocked by rules or
  // network doesn't prevent the other from firing. Keys are one-shot: once
  // added, they stay added even if the write fails, so re-emissions from
  // onSnapshot don't re-arm the same write. Unrecorded stats catch up on
  // the next app session. See the fan-out sites below for why re-arming on
  // failure produced a failed-precondition retry storm.
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
        for (const g of updatedGames) {
          // Catch up on stats for games that completed while user was away.
          // Fan out two writes in parallel — local user (always permitted by
          // isOwner) and opponent (gated by canPeerCloseStats in
          // firestore.rules). Without the opponent write, an absent loser's
          // `losses` counter never increments and the leaderboard skews.
          if ((g.status === "complete" || g.status === "forfeit") && g.winner) {
            const selfKey = `${g.id}:self`;
            const oppKey = `${g.id}:opp`;
            const won = g.winner === user.uid;
            const opponentUid = getOpponent(g, user.uid);
            if (!processedStatsRef.current.has(selfKey)) {
              processedStatsRef.current.add(selfKey);
              // Best-effort: on failure, log but LEAVE the key marked. Deleting
              // it here re-armed the write for the very next snapshot emit, and
              // with both participants online writing each other's stats that
              // became a failed-precondition retry storm (~2/sec) that never
              // settled. Leaving the key marked stops the loop; the next app
              // session catches up — updatePlayerStats is idempotent per game
              // via the lastStatsGameId transaction check in services/users.ts.
              updatePlayerStats(user.uid, g.id, won).catch((err) => {
                logger.warn("stats_catchup_failed", {
                  gameId: g.id,
                  error: parseFirebaseError(err),
                });
              });
            }
            if (!processedStatsRef.current.has(oppKey)) {
              processedStatsRef.current.add(oppKey);
              updatePlayerStats(opponentUid, g.id, !won).catch((err) => {
                logger.warn("opponent_stats_catchup_failed", {
                  gameId: g.id,
                  error: parseFirebaseError(err),
                });
              });
            }
          }
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
  }, [user, activeProfile, gamesLimit, sweepExpiredTurns]);

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
      // Update leaderboard stats when a game completes. Mirrors the
      // catch-up loop above — fan out self + opponent in parallel so the
      // loser's `losses` counter increments even if they never reopen
      // the app. Each write is guarded by an independent `:self`/`:opp`
      // key so a rules rejection on one side doesn't suppress the other's
      // attempt. Neither side retries on failure (see the catch-up loop's
      // note on the retry storm); unrecorded stats catch up next session.
      const currentUser = userRef.current;
      if ((updated.status === "complete" || updated.status === "forfeit") && currentUser && updated.winner) {
        const selfKey = `${updated.id}:self`;
        const oppKey = `${updated.id}:opp`;
        const won = updated.winner === currentUser.uid;
        const opponentUid = getOpponent(updated, currentUser.uid);
        if (!processedStatsRef.current.has(selfKey)) {
          processedStatsRef.current.add(selfKey);
          // Leave the key marked on failure — see the catch-up loop above for
          // why re-arming here caused a failed-precondition retry storm.
          updatePlayerStats(currentUser.uid, updated.id, won).catch((err) => {
            logger.warn("stats_update_failed", {
              gameId: updated.id,
              error: parseFirebaseError(err),
            });
          });
        }
        if (!processedStatsRef.current.has(oppKey)) {
          processedStatsRef.current.add(oppKey);
          updatePlayerStats(opponentUid, updated.id, !won).catch((err) => {
            logger.warn("opponent_stats_update_failed", {
              gameId: updated.id,
              error: parseFirebaseError(err),
            });
          });
        }
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
