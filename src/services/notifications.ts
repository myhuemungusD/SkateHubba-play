import { addDoc, collection, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";

export type NotificationDocType = "your_turn" | "new_challenge" | "game_won" | "game_lost";

interface WriteNotificationParams {
  senderUid: string;
  recipientUid: string;
  type: NotificationDocType;
  title: string;
  body: string;
  gameId: string;
}

/* ────────────────────────────────────────────
 * Client-side rate limiting (defense-in-depth)
 * ──────────────────────────────────────────── */

const lastNotificationAt = new Map<string, number>();
const NOTIFICATION_COOLDOWN_MS = 5_000;

function rateLimitKey(senderUid: string, gameId: string, type: string): string {
  return `${senderUid}_${gameId}_${type}`;
}

/** @internal Reset rate-limit state (for tests only) */
export function _resetNotificationRateLimit(): void {
  lastNotificationAt.clear();
}

/**
 * Write a notification document to the `notifications` collection.
 * The recipient's app listens to this collection via onSnapshot and
 * surfaces it as an in-app toast. This is the no-Cloud-Functions path
 * for alerting opponents about game events.
 *
 * Best-effort — failures are silently swallowed so they never block
 * the primary game action.
 */
export async function writeNotification(params: WriteNotificationParams): Promise<void> {
  const key = rateLimitKey(params.senderUid, params.gameId, params.type);

  // Client-side rate limit: skip silently if within cooldown
  const last = lastNotificationAt.get(key) ?? 0;
  if (Date.now() - last < NOTIFICATION_COOLDOWN_MS) {
    return;
  }

  try {
    await addDoc(collection(requireDb(), "notifications"), {
      senderUid: params.senderUid,
      recipientUid: params.recipientUid,
      type: params.type,
      title: params.title,
      body: params.body,
      gameId: params.gameId,
      read: false,
      createdAt: serverTimestamp(),
    });

    lastNotificationAt.set(key, Date.now());

    // Prune stale entries to prevent unbounded growth
    if (lastNotificationAt.size > 50) {
      const cutoff = Date.now() - 60_000;
      for (const [k, ts] of lastNotificationAt) {
        if (ts < cutoff) lastNotificationAt.delete(k);
      }
    }

    // Record rate-limit timestamp for server-side enforcement (fire-and-forget).
    // Written AFTER the notification so a failed notification doesn't create
    // a phantom cooldown that blocks the next legitimate attempt.
    const limitId = rateLimitKey(params.senderUid, params.gameId, params.type);
    setDoc(doc(requireDb(), "notification_limits", limitId), {
      senderUid: params.senderUid,
      gameId: params.gameId,
      type: params.type,
      lastSentAt: serverTimestamp(),
    }).catch((err) => {
      logger.warn("notification_rate_limit_write_failed", {
        senderUid: params.senderUid,
        gameId: params.gameId,
        type: params.type,
        error: parseFirebaseError(err),
      });
    });
  } catch (err) {
    // Best-effort — don't block the game action if notification write fails
    logger.warn("notification_write_failed", {
      recipientUid: params.recipientUid,
      type: params.type,
      error: parseFirebaseError(err),
    });
  }
}
