/**
 * Live Roll Dice state. Both hooks no-op until they have an id, so a
 * signed-out render and a flag-off route never open a listener.
 *
 * Snapshot state is keyed by the id that produced it. A uid or game change
 * reads as "not loaded yet" without calling setState in the effect body.
 */
import { useCallback, useEffect, useState } from "react";
import {
  subscribeToDiceGame,
  subscribeToDiceStats,
  subscribeToMyDiceGames,
  toDiceStats,
  type DiceGameDoc,
  type DiceStatsDoc,
} from "../services/dice";

const EMPTY_STATS: DiceStatsDoc = toDiceStats(undefined);

export function useMyDiceGames(uid: string | null): {
  games: DiceGameDoc[];
  stats: DiceStatsDoc;
  loading: boolean;
  error: boolean;
  retry: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const [gamesSlot, setGamesSlot] = useState<{ key: string; games: DiceGameDoc[] } | null>(null);
  const [statsSlot, setStatsSlot] = useState<{ uid: string; stats: DiceStatsDoc } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const key = `${uid ?? ""}#${attempt}`;

  useEffect(() => {
    if (!uid) return;
    return subscribeToMyDiceGames(
      uid,
      (next) => setGamesSlot({ key, games: next }),
      () => setFailedKey(key),
    );
  }, [uid, key]);

  useEffect(() => {
    if (!uid) return;
    return subscribeToDiceStats(uid, (next) => setStatsSlot({ uid, stats: next }));
  }, [uid]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const gotGames = gamesSlot !== null && gamesSlot.key === key;
  const failed = uid !== null && failedKey === key && !gotGames;
  const statsReady = statsSlot !== null && statsSlot.uid === uid;

  return {
    games: gotGames ? gamesSlot.games : [],
    stats: statsReady ? statsSlot.stats : EMPTY_STATS,
    loading: uid !== null && !failed && !(gotGames && statsReady),
    error: failed,
    retry,
  };
}

export function useDiceGame(gameId: string | undefined): {
  game: DiceGameDoc | null;
  loading: boolean;
  missing: boolean;
} {
  const [view, setView] = useState<{ id: string; game: DiceGameDoc | null; missing: boolean } | null>(null);

  useEffect(() => {
    if (!gameId) return;
    return subscribeToDiceGame(
      gameId,
      (next) => setView({ id: gameId, game: next, missing: next === null }),
      () => setView({ id: gameId, game: null, missing: true }),
    );
  }, [gameId]);

  const current = view !== null && view.id === gameId ? view : null;
  return {
    game: current?.game ?? null,
    loading: Boolean(gameId) && current === null,
    missing: current?.missing ?? false,
  };
}

/** Your own Roll Dice record (Rep, streak). Defaults while loading. */
export function useDiceStats(uid: string | null): DiceStatsDoc {
  const [slot, setSlot] = useState<{ uid: string; stats: DiceStatsDoc } | null>(null);
  useEffect(() => {
    if (!uid) return;
    return subscribeToDiceStats(uid, (next) => setSlot({ uid, stats: next }));
  }, [uid]);
  return slot !== null && slot.uid === uid ? slot.stats : EMPTY_STATS;
}
