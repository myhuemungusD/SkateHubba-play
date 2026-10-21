/**
 * Roll Dice part of account erasure.
 *
 * Every match the account played is handled in one transaction:
 *   1. An open match (pending or active) is closed first, so the other player
 *      is never left waiting on a turn that can't come. A match nobody has
 *      rolled in just ends; one that has started is a forfeit and the player
 *      who stays gets the win.
 *   2. The match is then anonymized (see `_anonymize.ts`): the departed uid and
 *      username are replaced by a tombstone, so the other player keeps their
 *      history and their win. When the other seat is already a tombstone (both
 *      players deleted their accounts) the match is deleted outright.
 *
 * The departing user's own diceStats and diceCreateLimits docs are deleted by
 * the orchestrator, so their loss is never written.
 */
import type { Firestore } from "firebase-admin/firestore";
import { DELETED_NAME, DELETED_UID, scrubUid } from "./_anonymize.js";
import { numField, scanAll } from "./_cascadeUtil.js";

export interface DiceErasureCounts {
  /** Open matches closed so the other player is not left waiting. */
  closed: number;
  /** Matches kept for the other player with this account replaced by the tombstone. */
  anonymized: number;
  /** Matches deleted because nobody real was left in them. */
  deleted: number;
}

/**
 * True once anyone has rolled or a round has already been won.
 * Mirrors `matchHasStarted` in functions/src/dice/engine.ts. Duplicated here
 * so account deletion (Vercel) does not import the Cloud Functions package.
 */
function diceMatchStarted(data: Record<string, unknown>): boolean {
  if (numField(data, "round") > 1 || numField(data, "rollCount") > 0) return true;
  const results = data.results;
  if (results && typeof results === "object" && Object.keys(results).length > 0) return true;
  const roundsWon = data.roundsWon;
  if (!roundsWon || typeof roundsWon !== "object") return false;
  return Object.values(roundsWon).some((n) => typeof n === "number" && n > 0);
}

function otherDicePlayer(data: Record<string, unknown>, uid: string): string | null {
  const p1 = data.player1Uid;
  const p2 = data.player2Uid;
  if (p1 === uid && typeof p2 === "string" && p2 !== uid) return p2;
  if (p2 === uid && typeof p1 === "string" && p1 !== uid) return p1;
  return null;
}

function isOpen(data: Record<string, unknown>): boolean {
  return data.status === "active" || data.status === "pending";
}

/** The fields that end an open match when this account leaves it. */
function closingPatch(data: Record<string, unknown>, uid: string, nowMs: number): Record<string, unknown> {
  const started = diceMatchStarted(data);
  if (started) {
    return {
      status: "forfeit",
      endReason: "quit",
      winner: otherDicePlayer(data, uid),
      currentTurn: null,
      updatedAt: nowMs,
    };
  }
  const challengerLeft = data.player1Uid === uid;
  return {
    status: challengerLeft ? "expired" : "declined",
    endReason: challengerLeft ? "quit" : "decline",
    winner: null,
    currentTurn: null,
    updatedAt: nowMs,
  };
}

/** The match with this account replaced by the tombstone, usernames included. */
export function anonymizedDiceMatch(data: Record<string, unknown>, uid: string): Record<string, unknown> {
  const out = scrubUid(data, uid) as Record<string, unknown>;
  if (out.player1Uid === DELETED_UID) out.player1Username = DELETED_NAME;
  if (out.player2Uid === DELETED_UID) out.player2Username = DELETED_NAME;
  return out;
}

export async function eraseDiceGames(db: Firestore, uid: string, nowMs: number): Promise<DiceErasureCounts> {
  const col = db.collection("diceGames");
  const [asP1, asP2] = await Promise.all([
    scanAll(col.where("player1Uid", "==", uid)),
    scanAll(col.where("player2Uid", "==", uid)),
  ]);
  const counts: DiceErasureCounts = { closed: 0, anonymized: 0, deleted: 0 };
  const seen = new Set<string>();
  for (const snap of [...asP1, ...asP2]) {
    if (seen.has(snap.id)) continue;
    seen.add(snap.id);
    const outcome = await db.runTransaction(async (tx) => {
      // Every read happens before any write (an Admin SDK transaction rule).
      const fresh = await tx.get(snap.ref);
      if (!fresh.exists) return null;
      const current = (fresh.data() ?? {}) as Record<string, unknown>;
      const other = otherDicePlayer(current, uid);
      const patch = isOpen(current) ? closingPatch(current, uid, nowMs) : null;
      const winner = patch?.winner;
      const statsRef =
        typeof winner === "string" && winner !== DELETED_UID ? db.collection("diceStats").doc(winner) : null;
      const stats = statsRef ? (((await tx.get(statsRef)).data() ?? {}) as Record<string, unknown>) : null;

      if (statsRef && stats) {
        tx.set(
          statsRef,
          {
            wins: numField(stats, "wins") + 1,
            losses: numField(stats, "losses"),
            gamesPlayed: numField(stats, "gamesPlayed") + 1,
            updatedAt: nowMs,
          },
          { merge: true },
        );
      }
      // Nobody real is left in the match: nothing to keep it for.
      if (other === null || other === DELETED_UID) {
        tx.delete(snap.ref);
        return { closed: patch !== null, kept: false };
      }
      tx.set(snap.ref, anonymizedDiceMatch({ ...current, ...(patch ?? {}) }, uid));
      return { closed: patch !== null, kept: true };
    });
    if (outcome === null) continue;
    if (outcome.closed) counts.closed += 1;
    if (outcome.kept) counts.anonymized += 1;
    else counts.deleted += 1;
  }
  return counts;
}
