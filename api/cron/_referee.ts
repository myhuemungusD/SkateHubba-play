/**
 * Write plumbing shared by the game referees (`sweep-expired-turns`,
 * `resolve-expired-disputes`): landed-clip and notification doc ids, the
 * in-transaction landed-clip write, and the post-transaction push fan-out to
 * /push_dispatch.
 *
 * The underscore prefix keeps Vercel's filesystem router from exposing this
 * module as an endpoint.
 */
import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { captureServerError } from "../_sentry.js";
import { safeErrorCode } from "../_safeError.js";

/** Collection the in-app notification feed reads — mirrors notifications.ts. */
export const NOTIFICATIONS_COLLECTION = "notifications";
/** Token mirror + dispatch collections — mirror pushDispatch.ts constants. */
const PUSH_TARGETS_COLLECTION = "pushTargets";
const PUSH_DISPATCH_COLLECTION = "push_dispatch";
/** Per-dispatch token cap — mirrors MAX_TOKENS_PER_DISPATCH in pushDispatch.ts. */
const MAX_TOKENS_PER_DISPATCH = 10;
/** User-visible string caps — mirror pushDispatch.ts. */
const MAX_TITLE_LEN = 80;
const MAX_BODY_LEN = 200;

/** The fields a server-written game notification carries. */
export interface AdminNotification {
  senderUid: string;
  recipientUid: string;
  type: string;
  title: string;
  body: string;
}

/** Build the landed-clip doc id — mirrors clipId() in clips.mappers.ts. */
function clipId(gameId: string, turnNumber: number, role: "set" | "match"): string {
  return `${gameId}_${turnNumber}_${role}`;
}

/** One confirmed landed clip for the feed. */
export interface AdminLandedClip {
  gameId: string;
  turnNumber: number;
  role: "set" | "match";
  playerUid: string;
  playerUsername: string;
  trickName: string;
  videoUrl: string;
  spotId: string | null;
}

/**
 * Write one confirmed landed clip inside the referee's transaction. Mirrors
 * writeLandedClipsInTransaction in clips.writes.ts; the doc id is deterministic
 * so a re-run overwrites rather than duplicates.
 */
export function writeAdminLandedClip(
  tx: Transaction,
  db: Firestore,
  clip: AdminLandedClip,
  createdAt: FieldValue,
): void {
  tx.set(db.collection("clips").doc(clipId(clip.gameId, clip.turnNumber, clip.role)), {
    ...clip,
    moderationStatus: "active",
    upvoteCount: 0,
    createdAt,
  });
}

/**
 * Deterministic notification doc id for a resolved turn. Keying on
 * (gameId, turnNumber, kind) makes the notification write idempotent: two
 * overlapping invocations that both read the still-expired doc write the same
 * notification doc instead of two.
 */
export function notifyId(gameId: string, turnNumber: number, kind: string): string {
  return `${gameId}_${turnNumber}_${kind}_notify`;
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** Mirror of buildDispatchDoc in pushDispatch.ts, using the admin SDK. */
function buildAdminDispatchDoc(n: AdminNotification, gameId: string, tokens: string[]): Record<string, unknown> {
  return {
    tokens,
    notification: { title: truncate(n.title, MAX_TITLE_LEN), body: truncate(n.body, MAX_BODY_LEN) },
    data: { gameId, type: n.type, click_action: `/?game=${gameId}` },
    senderUid: n.senderUid,
    recipientUid: n.recipientUid,
    gameId,
    type: n.type,
    createdAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Fire the OS-level push for a server-written notification, AFTER the game tx
 * committed. Reads the recipient's token mirror and writes a /push_dispatch doc
 * api/cron/drain-push-dispatch.ts drains. Best-effort: no tokens → no-op; any
 * failure is logged under `failureEvent` and swallowed so push health never
 * fails the cron.
 */
export async function dispatchAdminPush(
  db: Firestore,
  gameId: string,
  n: AdminNotification,
  failureEvent: string,
): Promise<void> {
  try {
    const targetSnap = await db.collection(PUSH_TARGETS_COLLECTION).doc(n.recipientUid).get();
    const raw = targetSnap.exists ? (targetSnap.data() as { tokens?: unknown }).tokens : undefined;
    const tokens = (Array.isArray(raw) ? raw : [])
      .filter((t): t is string => typeof t === "string" && t.length > 0)
      .slice(0, MAX_TOKENS_PER_DISPATCH);
    if (tokens.length === 0) return;
    await db.collection(PUSH_DISPATCH_COLLECTION).add(buildAdminDispatchDoc(n, gameId, tokens));
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: failureEvent,
        gameId,
        code: safeErrorCode(err),
      }),
    );
    captureServerError(failureEvent, err, { gameId }, { level: "warning" });
  }
}
