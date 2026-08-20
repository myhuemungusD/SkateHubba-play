/**
 * User-posted clip creation — the `source: "user"` half of the clips feed.
 *
 * Transactional, but for a different reason than the game path. Game clips
 * are written inside the turn transaction because a clip that disagrees with
 * the game it came from is corrupted multiplayer state. A user clip
 * references no game — it is transactional because the CREATE RULE demands a
 * companion write: `clips/{id}` (source "user") is only accepted when the
 * same atomic write also advances `users/{uid}.lastClipCreatedAt` to
 * `request.time`, and the pre-state value is at least 30 seconds old. The
 * rule's `getAfter()` makes that companion mandatory, so a client cannot
 * post a clip and skip the cooldown anchor.
 *
 * `runTransaction` rather than `writeBatch` because the same pre-read that
 * the rule performs server-side also lets us tell the caller WHY a post was
 * refused — cooldown, ban, or missing profile — instead of surfacing an
 * undifferentiated `permission-denied`.
 *
 * Write ordering (`createUserClip` documents the why):
 *   1. mint the clip id       — `newUserClipId()`
 *   2. upload the video       — `uploadUserClip(uid, clipId, blob)`
 *   3. write the Firestore doc — `createUserClip({ clipId, videoUrl, … })`
 */

import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { requireAuth, requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import { clipsRef } from "./clips.mappers";

/** Field caps mirrored from the clips create rule — fail fast, not authorize. */
const MAX_TRICK_NAME_LEN = 80;
const MAX_USERNAME_LEN = 20;
const MAX_VIDEO_URL_LEN = 2048;
const MAX_SPOT_ID_LEN = 64;

/**
 * Minimum gap between two user-clip posts, mirroring `clipRateLimitOk()` in
 * firestore.rules. The rule is authoritative; this constant only lets the
 * client refuse early with a useful message and a remaining-time hint.
 */
export const USER_CLIP_COOLDOWN_MS = 30_000;

/**
 * Thrown when the caller posted a clip less than
 * {@link USER_CLIP_COOLDOWN_MS} ago. The UI shows a countdown rather than an
 * error toast — this is a rate limit, not a failure.
 */
export class ClipCooldownError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`clip_cooldown:${retryAfterMs}`);
    this.name = "ClipCooldownError";
  }
}

/**
 * Thrown when the caller's profile carries `banned: true`. The rules deny
 * every UGC write for a banned account; catching it here means the UI can
 * say so plainly instead of reporting a generic permission failure.
 */
export class UserBannedError extends Error {
  constructor() {
    super("user_banned");
    this.name = "UserBannedError";
  }
}

/**
 * Download URLs for user clips are pinned by the rules to the caller's own
 * `userClips/{uid}/` prefix, in Firebase's `/o/<percent-encoded-path>` form
 * — the bucket-as-host CDN form that game clips may use is NOT accepted.
 * Checked here so a mis-plumbed upload fails with a legible message instead
 * of an opaque rejection at commit time.
 */
function isUserClipVideoUrl(url: string, uid: string): boolean {
  return new RegExp(
    `^https://firebasestorage\\.googleapis\\.com/v0/b/[^/]+/o/userClips%2F${uid}%2F[A-Za-z0-9_-]+\\.(webm|mp4)(\\?.*)?$`,
  ).test(url);
}

/** Millisecond value of a Firestore Timestamp-ish field, or null. */
function toMillisOrNull(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const toMillis = (value as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== "function") return null;
  const ms: unknown = toMillis.call(value);
  return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
}

export interface CreateUserClipParams {
  /**
   * Doc id minted by {@link newUserClipId} BEFORE the upload — the storage
   * object at `userClips/{uid}/{clipId}.{ext}` is named after it.
   */
  clipId: string;
  /**
   * Author uid. Optional, and only ever a cross-check: the value actually
   * written comes from the signed-in user, because the create rule pins
   * `playerUid` to `request.auth.uid`. Passing somebody else's uid throws
   * rather than silently writing your own — a caller that believes it is
   * posting as another user has a bug worth surfacing.
   */
  playerUid?: string;
  /** Denormalized author username, as of write time. */
  playerUsername: string;
  /** What the skater landed. Free text, capped at 100 chars. */
  trickName: string;
  /** Download URL returned by `uploadUserClip`. */
  videoUrl: string;
  /** Optional spot tag. */
  spotId: string | null;
}

/**
 * Mint a random clip id without writing anything.
 *
 * `doc(collection)` generates a client-side id, which is what lets the video
 * upload happen FIRST: the storage path embeds the clip id, and a Firestore
 * doc pointing at a video that failed to upload is worse than an orphaned
 * video object (the feed would render a broken clip, vs. an invisible file
 * the storage lifecycle rule reaps). Abandoning the id costs nothing — no
 * document was created.
 */
export function newUserClipId(): string {
  return doc(clipsRef()).id;
}

/**
 * Write the Firestore doc for an already-uploaded user clip, together with
 * the mandatory `users/{uid}.lastClipCreatedAt` cooldown anchor.
 *
 * `playerUid` is taken from the signed-in user rather than a parameter: the
 * create rule pins it to `request.auth.uid`, so accepting it from the caller
 * would only create a way to build a write that cannot succeed.
 *
 * `tx.set` at the pre-minted id (not `addDoc`) because the id is already
 * committed to by the storage path.
 *
 * Both vote aggregates seed at 0 and `moderationStatus` at "active" — the
 * only values the create rule accepts; takedowns are Admin SDK only.
 *
 * Throws {@link ClipCooldownError} inside the cooldown window,
 * {@link UserBannedError} for a banned account, and a plain error when the
 * profile doc is missing (the rules cannot accept the companion update
 * without one).
 */
export async function createUserClip(params: CreateUserClipParams): Promise<string> {
  const { clipId, playerUid, playerUsername, trickName, videoUrl, spotId } = params;

  if (!clipId || clipId.includes("/")) throw new Error("Invalid clip id.");

  const uid = requireAuth().currentUser?.uid;
  if (!uid) throw new Error("You must be signed in to post a clip.");
  if (typeof playerUid === "string" && playerUid !== uid) {
    throw new Error("You can only post clips as yourself.");
  }

  const trimmedTrick = typeof trickName === "string" ? trickName.trim() : "";
  if (trimmedTrick.length === 0) throw new Error("Name the trick before posting.");
  if (trimmedTrick.length > MAX_TRICK_NAME_LEN) {
    throw new Error(`Trick names are limited to ${MAX_TRICK_NAME_LEN} characters.`);
  }
  if (
    typeof videoUrl !== "string" ||
    videoUrl.length === 0 ||
    videoUrl.length > MAX_VIDEO_URL_LEN ||
    !isUserClipVideoUrl(videoUrl, uid)
  ) {
    throw new Error("That video could not be attached. Please try again.");
  }

  const username = typeof playerUsername === "string" ? playerUsername.trim().slice(0, MAX_USERNAME_LEN) : "";
  if (username.length === 0) throw new Error("Set a username before posting a clip.");

  const db = requireDb();
  const clipRef = doc(db, "clips", clipId);
  const userRef = doc(db, "users", uid);

  try {
    await runTransaction(db, async (tx) => {
      // The rule reads this same doc: no profile means the mandatory
      // companion update has nothing to land on, and `banned` / the cooldown
      // anchor both live here.
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists()) throw new Error("Finish setting up your profile before posting a clip.");
      const userData = userSnap.data() as { banned?: unknown; lastClipCreatedAt?: unknown };
      if (userData.banned === true) throw new UserBannedError();

      const lastMs = toMillisOrNull(userData.lastClipCreatedAt);
      if (lastMs !== null) {
        const elapsed = Date.now() - lastMs;
        if (elapsed < USER_CLIP_COOLDOWN_MS) {
          // Clamp into [0, cooldown]: a clock skew that puts the anchor in
          // the future would otherwise report a wait longer than the
          // cooldown itself, and the UI would count down from a lie.
          throw new ClipCooldownError(Math.min(USER_CLIP_COOLDOWN_MS, Math.max(0, USER_CLIP_COOLDOWN_MS - elapsed)));
        }
      }

      tx.set(clipRef, {
        // The discriminant. Present on every user clip from day one, which
        // is what lets the mapper read a MISSING source as "game" (every
        // clip written before this feature was game-sourced).
        source: "user",
        // Explicit nulls, not omitted keys: the mapper and the rules both
        // read these fields, and "absent" would be indistinguishable from a
        // malformed game clip.
        gameId: null,
        turnNumber: null,
        role: null,
        playerUid: uid,
        playerUsername: username,
        trickName: trimmedTrick,
        videoUrl,
        spotId: typeof spotId === "string" && spotId.length > 0 ? spotId.slice(0, MAX_SPOT_ID_LEN) : null,
        createdAt: serverTimestamp(),
        moderationStatus: "active",
        upvoteCount: 0,
        downvoteCount: 0,
      });

      // Mandatory companion write. `update` (not set/merge) because the
      // owner-update rule is what pins this field to `request.time`, and the
      // profile is known to exist from the read above.
      tx.update(userRef, { lastClipCreatedAt: serverTimestamp() });
    });
    return clipId;
  } catch (err) {
    // Typed refusals are the caller's to render — a cooldown countdown and a
    // ban notice are not "try again" situations.
    if (err instanceof ClipCooldownError || err instanceof UserBannedError) throw err;
    logger.warn("user_clip_create_failed", { clipId, error: parseFirebaseError(err) });
    throw new Error("Failed to post your clip. Please try again.");
  }
}
