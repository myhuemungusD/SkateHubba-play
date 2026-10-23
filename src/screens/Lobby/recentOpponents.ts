import type { GameDoc } from "../../services/games";

/** One row of Home's "Recently played" list. */
export interface RecentOpponent {
  uid: string;
  username: string;
  isVerifiedPro: boolean;
  /** Games against this skater among the games Home has loaded. */
  games: number;
  /** Finished games against them that had a winner (the record's denominator). */
  decided: number;
  /** Of those, how many the viewer won. */
  wins: number;
  /** Newest game against them, for ordering. 0 when no timestamp is set. */
  lastPlayedMs: number;
  /** A game still in progress against them, if any: Home opens it instead of starting a second one. */
  activeGame: GameDoc | null;
}

function gameTimeMs(g: GameDoc): number {
  const t = g.updatedAt ?? g.createdAt;
  return t && typeof t.toMillis === "function" ? t.toMillis() : 0;
}

/**
 * Distinct opponents from the viewer's own games (active and finished), most
 * recent first. Built only from the game docs Home already reads, so it adds no
 * queries and needs no rules change. Games the viewer only refereed are skipped,
 * as are blocked skaters.
 */
export function recentOpponents(
  games: readonly GameDoc[],
  viewerUid: string,
  blockedUids: ReadonlySet<string> = new Set(),
  max = 5,
): RecentOpponent[] {
  const byUid = new Map<string, RecentOpponent>();
  for (const g of games) {
    const isP1 = g.player1Uid === viewerUid;
    if (!isP1 && g.player2Uid !== viewerUid) continue;
    const uid = isP1 ? g.player2Uid : g.player1Uid;
    const username = isP1 ? g.player2Username : g.player1Username;
    if (!uid || !username || uid === viewerUid || blockedUids.has(uid)) continue;
    const ms = gameTimeMs(g);
    const isVerifiedPro = (isP1 ? g.player2IsVerifiedPro : g.player1IsVerifiedPro) === true;
    const active = g.status === "active" ? g : null;
    const decided = !active && !!g.winner ? 1 : 0;
    const won = decided && g.winner === viewerUid ? 1 : 0;
    const row = byUid.get(uid);
    if (!row) {
      byUid.set(uid, {
        uid,
        username,
        isVerifiedPro,
        games: 1,
        decided,
        wins: won,
        lastPlayedMs: ms,
        activeGame: active,
      });
      continue;
    }
    row.games += 1;
    row.decided += decided;
    row.wins += won;
    if (ms > row.lastPlayedMs) {
      row.lastPlayedMs = ms;
      row.username = username;
    }
    if (active && (!row.activeGame || gameTimeMs(active) > gameTimeMs(row.activeGame))) row.activeGame = active;
  }
  // Stable sort keeps the incoming (newest-first) order for equal timestamps.
  return [...byUid.values()].sort((a, b) => b.lastPlayedMs - a.lastPlayedMs).slice(0, max);
}
