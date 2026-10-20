/**
 * Lifetime dice stats and Rep, written in the same transaction that decides
 * the match. Only a decided match (target reached, or a forfeit after play
 * started) counts. Clients can read a diceStats doc but never write one.
 */
import { statsDelta, type DiceMatch } from "./engine.js";
import { num, asRecord } from "./docs.js";
import { repOf, repSwing, REP_START } from "./rating.js";
import type { DiceTx } from "./store.js";

/** Reads both stats docs, then writes both (Admin SDK transactions reject a read after a write). */
export async function writeStats(tx: DiceTx, state: DiceMatch, nowMs: number): Promise<Record<string, number>> {
  const delta = statsDelta(state);
  if (!delta) return {};
  const [winSnap, loseSnap] = await Promise.all([
    tx.get(`diceStats/${delta.winnerUid}`),
    tx.get(`diceStats/${delta.loserUid}`),
  ]);
  const win = winSnap.data ?? {};
  const lose = loseSnap.data ?? {};
  const winRep = repOf(win.rep);
  const loseRep = repOf(lose.rep);
  const swing = repSwing(winRep, loseRep);

  const row = (data: Record<string, unknown>, won: boolean, rep: number): Record<string, unknown> => {
    const byMode = { ...(asRecord(data.byMode) ?? {}) };
    const mode = asRecord(byMode[state.mode]) ?? {};
    byMode[state.mode] = { wins: num(mode.wins) + (won ? 1 : 0), losses: num(mode.losses) + (won ? 0 : 1) };
    const streak = won ? num(data.streak) + 1 : 0;
    return {
      wins: num(data.wins) + (won ? 1 : 0),
      losses: num(data.losses) + (won ? 0 : 1),
      gamesPlayed: num(data.gamesPlayed) + 1,
      rep,
      peakRep: Math.max(num(data.peakRep) || REP_START, rep),
      streak,
      bestStreak: Math.max(num(data.bestStreak), streak),
      byMode,
      updatedAt: nowMs,
    };
  };
  tx.set(`diceStats/${delta.winnerUid}`, row(win, true, winRep + swing.winner), true);
  tx.set(`diceStats/${delta.loserUid}`, row(lose, false, loseRep + swing.loser), true);
  return { [delta.winnerUid]: swing.winner, [delta.loserUid]: swing.loser };
}
