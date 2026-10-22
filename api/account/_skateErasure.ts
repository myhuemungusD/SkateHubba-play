/**
 * Active S.K.A.T.E. games during account erasure.
 *
 * Finished games are deleted outright with their videos (see
 * `_deleteUserData.ts`). Active games used to be left exactly as they were,
 * so the deleted account's uid, username and turn videos stayed in the game
 * doc and in Storage indefinitely, and nothing revisited them once the game
 * ended. That contradicted the deletion promise (security audit 2026-10-21,
 * H4).
 *
 * Each active game is now closed and anonymized, mirroring Roll Dice
 * (`_diceErasure.ts`):
 *   1. The departing player's own uploads in the game folder are deleted
 *      first. Game uploads are named `{role}-{uploaderUid}.{ext}`, so they can
 *      be told apart from the opponent's. Done before the doc write, because
 *      once the doc no longer names the uid a retry can't find the game again.
 *   2. The game is closed as a forfeit with the opponent as the winner, so the
 *      opponent is not left waiting on a turn that can never come. The stats
 *      trigger (`onGameCompleted`) then credits the win. The loser's profile is
 *      gone, so no loss is written.
 *   3. The departed uid becomes the tombstone everywhere in the doc,
 *      usernames become the tombstone name, and every video URL that pointed
 *      at the departed player's uploads is cleared.
 * When the other seat is already a tombstone (both players deleted their
 * accounts) the game and its whole folder are deleted instead.
 */
import type { Firestore } from "firebase-admin/firestore";
import { DELETED_NAME, DELETED_UID, scrubUid } from "./_anonymize.js";
import { deletePrefix, scanAll, type CascadeDeps } from "./_cascadeUtil.js";

export interface SkateErasureCounts {
  /** Active games closed as a forfeit so the opponent wins. */
  forfeited: number;
  /** Games kept for the opponent with this account replaced by the tombstone. */
  anonymized: number;
  /** Games deleted because nobody real was left in them. */
  deleted: number;
  /** The departing player's own video objects removed from kept games' folders. */
  videoObjects: number;
}

function otherPlayer(data: Record<string, unknown>, uid: string): string | null {
  const p1 = data.player1Uid;
  const p2 = data.player2Uid;
  if (p1 === uid && typeof p2 === "string" && p2 !== uid) return p2;
  if (p2 === uid && typeof p1 === "string" && p1 !== uid) return p1;
  return null;
}

/** Null every string that embeds the uid without being it (upload URLs carry it in the file name). */
function clearUidStrings(value: unknown, uid: string): unknown {
  if (typeof value === "string") return value !== uid && value.includes(uid) ? null : value;
  if (Array.isArray(value)) return value.map((item) => clearUidStrings(item, uid));
  if (value === null || typeof value !== "object") return value;
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) out[key] = clearUidStrings(inner, uid);
  return out;
}

function anonymizeTurn(entry: unknown): unknown {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return entry;
  const turn = { ...(entry as Record<string, unknown>) };
  if (turn.setterUid === DELETED_UID) {
    turn.setterUsername = DELETED_NAME;
    turn.setVideoUrl = null;
  }
  if (turn.matcherUid === DELETED_UID) {
    turn.matcherUsername = DELETED_NAME;
    turn.matchVideoUrl = null;
  }
  return turn;
}

/** The game with this account replaced by the tombstone and its videos unlinked. */
export function anonymizedSkateGame(data: Record<string, unknown>, uid: string): Record<string, unknown> {
  // Strings that embed the uid (upload URLs) go first; scrubUid then swaps
  // exact uid values and uid-keyed maps for the tombstone.
  const out = scrubUid(clearUidStrings(data, uid), uid) as Record<string, unknown>;
  for (const seat of ["player1", "player2"] as const) {
    if (out[`${seat}Uid`] === DELETED_UID) {
      out[`${seat}Username`] = DELETED_NAME;
      if (`${seat}IsVerifiedPro` in out) out[`${seat}IsVerifiedPro`] = false;
    }
  }
  if (out.judgeId === DELETED_UID) out.judgeUsername = DELETED_NAME;
  // Legacy uploads named without the uid: unlink by role instead.
  if (out.currentSetter === DELETED_UID) out.currentTrickVideoUrl = null;
  if (out.currentSetter !== DELETED_UID && out.currentTurn === DELETED_UID) out.matchVideoUrl = null;
  if (Array.isArray(out.turnHistory)) out.turnHistory = out.turnHistory.map(anonymizeTurn);
  return out;
}

/** Delete only the departing player's uploads under one game's folder. */
async function deleteOwnUploads(deps: CascadeDeps, gameId: string, uid: string): Promise<number> {
  const [files] = await deps.storage.bucket(deps.bucketName).getFiles({ prefix: `games/${gameId}/` });
  const mine = files.filter((f) => {
    const base = f.name.slice(f.name.lastIndexOf("/") + 1);
    return base.endsWith(`-${uid}.webm`) || base.endsWith(`-${uid}.mp4`);
  });
  for (const f of mine) await f.delete({ ignoreNotFound: true });
  return mine.length;
}

/**
 * Close and anonymize every active S.K.A.T.E. game this account plays in.
 * `activeGameIds` are the ids the orchestrator found with status "active".
 */
export async function eraseActiveSkateGames(
  deps: CascadeDeps,
  uid: string,
  activeGameIds: readonly string[],
  nowMs: number,
): Promise<SkateErasureCounts> {
  const db: Firestore = deps.db;
  const counts: SkateErasureCounts = { forfeited: 0, anonymized: 0, deleted: 0, videoObjects: 0 };
  for (const gameId of new Set(activeGameIds)) {
    const ref = db.collection("games").doc(gameId);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const other = otherPlayer((snap.data() ?? {}) as Record<string, unknown>, uid);

    if (other === null || other === DELETED_UID) {
      // Nobody real left: same as a finished game, videos first.
      counts.videoObjects += await deletePrefix(deps, `games/${gameId}/`);
      await ref.delete();
      counts.deleted += 1;
      continue;
    }

    counts.videoObjects += await deleteOwnUploads(deps, gameId, uid);
    const outcome = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      if (!fresh.exists) return null;
      const current = (fresh.data() ?? {}) as Record<string, unknown>;
      if (otherPlayer(current, uid) === null) return null;
      const closing =
        current.status === "active" ? { status: "forfeit", winner: other, updatedAt: new Date(nowMs) } : null;
      tx.set(ref, anonymizedSkateGame({ ...current, ...(closing ?? {}) }, uid));
      return { closed: closing !== null };
    });
    if (outcome === null) continue;
    if (outcome.closed) counts.forfeited += 1;
    counts.anonymized += 1;
  }
  return counts;
}

/**
 * Games this account judged but did not play: the judge's uid and username
 * are replaced by the tombstone. The game itself belongs to the two players
 * and is left running.
 */
export async function anonymizeJudgedGames(db: Firestore, uid: string): Promise<number> {
  const snaps = await scanAll(db.collection("games").where("judgeId", "==", uid));
  let count = 0;
  for (const snap of snaps) {
    const kept = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(snap.ref);
      if (!fresh.exists) return false;
      const current = (fresh.data() ?? {}) as Record<string, unknown>;
      if (current.judgeId !== uid || current.player1Uid === uid || current.player2Uid === uid) return false;
      tx.set(snap.ref, anonymizedSkateGame(current, uid));
      return true;
    });
    if (kept) count += 1;
  }
  return count;
}
