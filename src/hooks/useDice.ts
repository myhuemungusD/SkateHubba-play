/**
 * Live Roll Dice state. Both hooks no-op until they have an id, so a
 * signed-out render and a flag-off route never open a listener.
 *
 * Snapshot state is keyed by the id that produced it. A uid or game change
 * reads as "not loaded yet" without calling setState in the effect body.
 */
import { useEffect, useState } from "react";
import {
  subscribeToDiceGame,
  subscribeToDiceStats,
  subscribeToMyDiceGames,
  type DiceGameDoc,
  type DiceStatsDoc,
} from "../services/dice";

const EMPTY_STATS: DiceStatsDoc = { wins: 0, losses: 0, gamesPlayed: 0 };

export function useMyDiceGames(uid: string | null): {
  games: DiceGameDoc[];
  stats: DiceStatsDoc;
  loading: boolean;
} {
  const [gamesSlot, setGamesSlot] = useState<{ uid: string; games: DiceGameDoc[] } | null>(null);
  const [statsSlot, setStatsSlot] = useState<{ uid: string; stats: DiceStatsDoc } | null>(null);
  const [gamesFailedUid, setGamesFailedUid] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    return subscribeToMyDiceGames(
      uid,
      (next) => setGamesSlot({ uid, games: next }),
      () => setGamesFailedUid(uid),
    );
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    return subscribeToDiceStats(uid, (next) => setStatsSlot({ uid, stats: next }));
  }, [uid]);

  const gamesReady = (gamesSlot !== null && gamesSlot.uid === uid) || (uid !== null && gamesFailedUid === uid);
  const statsReady = statsSlot !== null && statsSlot.uid === uid;

  return {
    games: gamesSlot !== null && gamesSlot.uid === uid ? gamesSlot.games : [],
    stats: statsSlot !== null && statsSlot.uid === uid ? statsSlot.stats : EMPTY_STATS,
    loading: uid !== null && !(gamesReady && statsReady),
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
