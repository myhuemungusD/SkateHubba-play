import { collection, doc, getDoc, serverTimestamp, writeBatch, type Timestamp } from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import { dispatchPushNotification } from "./pushDispatch";

/** Cooldown between nudges for the same (sender, game) pair. Mirrors the 1-hour
 *  window enforced server-side by the /nudge_limits rules. */
export const NUDGE_COOLDOWN_MS = 1 * 60 * 60 * 1000; // 1 hour

/** Collection holding the server-side cooldown anchors. */
const NUDGE_LIMITS_COLLECTION = "nudge_limits";

/** Shown when the 1-hour window has not elapsed, from either the local
 *  fast-path or a server rejection — the two must be indistinguishable. */
const COOLDOWN_MESSAGE = "You can only nudge once per hour per game";

/** Shown for anything else. Raw Firebase strings must never reach the UI. */
const GENERIC_FAILURE_MESSAGE = "Couldn't send nudge. Try again.";

interface SendNudgeParams {
  gameId: string;
  senderUid: string;
  senderUsername: string;
  recipientUid: string;
}

/** Deterministic key for both the localStorage fast-path and the limits doc id. */
function limitKey(senderUid: string, gameId: string): string {
  return `${senderUid}_${gameId}`;
}

function localCooldownKey(senderUid: string, gameId: string): string {
  return `nudge_${limitKey(senderUid, gameId)}`;
}

/**
 * Send a nudge to an opponent. Writes a doc to the /nudges collection.
 *
 * DELIVERY: two channels, both required.
 *  1. In-app — the recipient's `subscribeToNudges` listener turns the /nudges
 *     doc into a toast if their tab is open.
 *  2. OS push — a /push_dispatch doc with type "nudge", drained by
 *     `api/cron/drain-push-dispatch.ts` and delivered by FCM within ~5 minutes.
 *
 * Channel 2 is the whole point of the feature and used to be missing: nudges
 * were in-app only, which meant a nudge reached exactly one kind of user — the
 * one already staring at the app, who by definition does not need nudging. The
 * push path required widening the /push_dispatch type allowlist to accept
 * "nudge" (see firestore.rules); the existing 1-hour /nudge_limits cooldown
 * already bounds it far harder than the generic 5s dispatch cooldown, so it
 * adds no new amplification surface.
 *
 * Rate-limited both client-side (localStorage) and server-side (Firestore rules).
 *
 * The nudge doc and the nudge_limits cooldown doc are committed in a single
 * writeBatch so the rules-side getAfter() companion-write check sees both —
 * a partial commit (e.g. nudge without limit) is impossible, which closes the
 * H1 bypass where a client could spam /nudges by simply not writing the
 * cooldown doc.
 *
 * @throws Error with a user-safe message — never a raw Firebase error string.
 */
export async function sendNudge({ gameId, senderUid, senderUsername, recipientUid }: SendNudgeParams): Promise<void> {
  // Client-side cooldown fast-path (keyed by user+game to avoid cross-user
  // interference). Cheap pre-check only — localStorage is per-device, so the
  // server is the source of truth and a miss here is expected, not exceptional.
  const key = localCooldownKey(senderUid, gameId);
  const last = parseInt(localStorage.getItem(key) ?? "0", 10) || 0;
  if (Date.now() - last < NUDGE_COOLDOWN_MS) {
    throw new Error(COOLDOWN_MESSAGE);
  }

  const db = requireDb();

  const nudgeRef = doc(collection(db, "nudges"));
  const limitRef = doc(db, NUDGE_LIMITS_COLLECTION, limitKey(senderUid, gameId));

  const batch = writeBatch(db);
  batch.set(nudgeRef, {
    senderUid,
    senderUsername,
    recipientUid,
    gameId,
    createdAt: serverTimestamp(),
    delivered: false,
  });
  batch.set(limitRef, { senderUid, gameId, lastNudgedAt: serverTimestamp() });

  try {
    await batch.commit();
  } catch (err) {
    // The overwhelmingly likely rejection is the /nudge_limits 1-hour rule
    // firing because this user already nudged from another device — their
    // localStorage said otherwise. Surfacing "Missing or insufficient
    // permissions." for that is both alarming and useless, so map it to the
    // same copy the local fast-path uses.
    logger.warn("nudge_send_failed", { gameId, error: parseFirebaseError(err) });
    throw new Error(isPermissionDenied(err) ? COOLDOWN_MESSAGE : GENERIC_FAILURE_MESSAGE);
  }

  // Record locally for the client-side fast-path.
  localStorage.setItem(key, String(Date.now()));

  // OS-level wake-up. Fire-and-forget AFTER the commit, mirroring
  // writeNotification: a dispatch failure (no registered devices, dispatch
  // cooldown) must never undo a nudge that already landed or throw into the
  // caller. Title/body match the in-app toast copy in GameNotificationWatcher
  // so the push and the toast read identically.
  void dispatchPushNotification({
    senderUid,
    recipientUid,
    type: "nudge",
    title: "You got nudged!",
    body: `@${senderUsername} is waiting for your move`,
    gameId,
  });
}

/** True for a Firestore rules rejection (as opposed to a network/internal fault). */
function isPermissionDenied(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "permission-denied" || code === "firestore/permission-denied";
}

/**
 * Check if the nudge cooldown has elapsed for a specific game, according to
 * this device's localStorage.
 *
 * Synchronous and therefore safe for the initial render, but device-local:
 * a nudge sent from the user's phone is invisible here. Pair it with
 * {@link getServerNudgeCooldownMs} to reconcile against the real cooldown.
 */
export function canNudge(gameId: string, senderUid: string): boolean {
  const key = localCooldownKey(senderUid, gameId);
  const last = parseInt(localStorage.getItem(key) ?? "0", 10) || 0;
  return Date.now() - last >= NUDGE_COOLDOWN_MS;
}

/**
 * Resolve the remaining nudge cooldown from the server anchor at
 * /nudge_limits/{senderUid}_{gameId}. Returns 0 when nudging is allowed.
 *
 * This is the cross-device truth `canNudge` cannot see. The /nudge_limits read
 * rule permits the sender to read their own limit doc, so this needs no new
 * rules surface.
 *
 * Best-effort: any read failure resolves to 0 rather than rejecting. A
 * transient error must never brick the button — the server rule still rejects
 * the write, and `sendNudge` maps that rejection to friendly copy.
 */
export async function getServerNudgeCooldownMs(gameId: string, senderUid: string): Promise<number> {
  try {
    const snap = await getDoc(doc(requireDb(), NUDGE_LIMITS_COLLECTION, limitKey(senderUid, gameId)));
    if (!snap.exists()) return 0;
    const lastNudgedAt = (snap.data() as { lastNudgedAt?: Timestamp | null }).lastNudgedAt;
    // serverTimestamp() resolves asynchronously; a doc read back in the same
    // instant can carry null. Treat unresolved as "no cooldown known" and let
    // the local fast-path or the server rule handle it.
    if (!lastNudgedAt || typeof lastNudgedAt.toMillis !== "function") return 0;
    return Math.max(0, NUDGE_COOLDOWN_MS - (Date.now() - lastNudgedAt.toMillis()));
  } catch (err) {
    logger.warn("nudge_cooldown_read_failed", { gameId, error: parseFirebaseError(err) });
    return 0;
  }
}
