/**
 * Transactional clip writes — invoked from inside the same `runTransaction`
 * in games.* that appends the TurnRecord, so a clip doc exists iff the turn
 * it references exists.
 */

import { doc, serverTimestamp, type FieldValue, type Transaction } from "firebase/firestore";
import { requireDb } from "../firebase";
import { clipId, type ClipModerationStatus, type ClipRole, type LandedClipContext } from "./clips.mappers";

/* ────────────────────────────────────────────
 * Transactional writes (called from games.ts)
 * ──────────────────────────────────────────── */

interface ClipWritePayload {
  /**
   * Discriminant, pinned to 'game' by the create rule. Written explicitly
   * even though the read mapper defaults a missing value to "game": the
   * default exists for the legacy corpus, not for new writes, and the rule
   * requires the field.
   */
  source: "game";
  gameId: string;
  turnNumber: number;
  role: ClipRole;
  playerUid: string;
  playerUsername: string;
  trickName: string;
  videoUrl: string;
  spotId: string | null;
  createdAt: FieldValue;
  moderationStatus: ClipModerationStatus;
  upvoteCount: number;
  /** Seeds at 0 — the create rule accepts absent-or-0 and nothing else. */
  downvoteCount: number;
}

function buildClipPayload(ctx: Omit<ClipWritePayload, "createdAt">, createdAt: FieldValue): ClipWritePayload {
  return { ...ctx, createdAt };
}

/**
 * Queue 0–2 clip doc writes on an in-flight game transaction.
 *
 * The `set` clip is written whenever the setter recorded a video (their set
 * was landed by construction — `failSetTrick` never appends to turnHistory).
 * The `match` clip is written only when the matcher actually landed and a
 * video was recorded; missed attempts aren't feed content.
 */
export function writeLandedClipsInTransaction(tx: Transaction, ctx: LandedClipContext): void {
  const db = requireDb();
  const createdAt = serverTimestamp();

  if (ctx.setVideoUrl) {
    const setRef = doc(db, "clips", clipId(ctx.gameId, ctx.turnNumber, "set"));
    tx.set(
      setRef,
      buildClipPayload(
        {
          source: "game",
          gameId: ctx.gameId,
          turnNumber: ctx.turnNumber,
          role: "set",
          playerUid: ctx.setterUid,
          playerUsername: ctx.setterUsername,
          trickName: ctx.trickName,
          videoUrl: ctx.setVideoUrl,
          spotId: ctx.spotId,
          moderationStatus: "active",
          upvoteCount: 0,
          downvoteCount: 0,
        },
        createdAt,
      ),
    );
  }

  if (ctx.matcherLanded && ctx.matchVideoUrl) {
    const matchRef = doc(db, "clips", clipId(ctx.gameId, ctx.turnNumber, "match"));
    tx.set(
      matchRef,
      buildClipPayload(
        {
          source: "game",
          gameId: ctx.gameId,
          turnNumber: ctx.turnNumber,
          role: "match",
          playerUid: ctx.matcherUid,
          playerUsername: ctx.matcherUsername,
          trickName: ctx.trickName,
          videoUrl: ctx.matchVideoUrl,
          spotId: ctx.spotId,
          moderationStatus: "active",
          upvoteCount: 0,
          downvoteCount: 0,
        },
        createdAt,
      ),
    );
  }
}
