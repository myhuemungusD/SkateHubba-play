import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";

export type NotificationDocType = "your_turn" | "new_challenge" | "game_won" | "game_lost" | "judge_invite";

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

    const now = Date.now();
    lastNotificationAt.set(key, now);

    // Drop entries past the cooldown window so the map stays bounded.
    // Snapshot keys first to avoid mutating during iteration.
    const cutoff = now - NOTIFICATION_COOLDOWN_MS;
    for (const [k, ts] of Array.from(lastNotificationAt)) {
      if (ts < cutoff) lastNotificationAt.delete(k);
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

// ── Notification read/delete ──────────────────────────────

/**
 * Mark a single notification as read (best-effort).
 */
export async function markNotificationRead(notificationId: string): Promise<void> {
  try {
    await updateDoc(doc(requireDb(), "notifications", notificationId), { read: true });
  } catch (err) {
    logger.warn("notification_mark_read_failed", {
      notificationId,
      error: parseFirebaseError(err),
    });
  }
}

/**
 * Delete a single notification document.
 */
export async function deleteNotification(notificationId: string): Promise<void> {
  await deleteDoc(doc(requireDb(), "notifications", notificationId));
}

/**
 * Delete all notification documents for a user. Best-effort batch delete.
 */
export async function deleteUserNotifications(uid: string): Promise<void> {
  const q = query(collection(requireDb(), "notifications"), where("recipientUid", "==", uid));
  const snap = await getDocs(q);
  const deletions = snap.docs.map((d) => deleteDoc(d.ref));
  await Promise.all(deletions);
}

// ── Real-time subscriptions (extracted from GameNotificationWatcher) ──

export interface NudgeEvent {
  senderUsername: string;
  gameId: string;
}

/**
 * Subscribe to incoming nudges for a user. Fires `onNudge` only for
 * newly added docs (skips the initial snapshot seed).
 */
export function subscribeToNudges(uid: string, onNudge: (nudge: NudgeEvent) => void): Unsubscribe {
  const db = requireDb();
  const q = query(collection(db, "nudges"), where("recipientUid", "==", uid), orderBy("createdAt", "desc"), limit(5));

  let initialIds: Set<string> | null = null;
  let ready = false;

  return onSnapshot(
    q,
    (snap) => {
      if (initialIds === null) {
        initialIds = new Set(snap.docs.map((d) => d.id));
        setTimeout(() => {
          ready = true;
        }, 0);
        return;
      }
      if (!ready) return;

      for (const change of snap.docChanges()) {
        if (change.type === "added" && !initialIds.has(change.doc.id)) {
          const data = change.doc.data();
          onNudge({ senderUsername: data.senderUsername, gameId: data.gameId });
          initialIds.add(change.doc.id);
          if (initialIds.size > 50) {
            initialIds = new Set(Array.from(initialIds).slice(-25));
          }
        }
      }
    },
    (err) => {
      logger.warn("nudge_subscription_error", { uid, error: parseFirebaseError(err) });
    },
  );
}

export interface NotificationEvent {
  type: string;
  title: string;
  body: string;
  gameId: string;
}

/**
 * Subscribe to unread notifications for a user. Fires `onNotification`
 * for newly added docs and automatically marks them as read.
 */
export function subscribeToNotifications(uid: string, onNotification: (notif: NotificationEvent) => void): Unsubscribe {
  const db = requireDb();
  const q = query(
    collection(db, "notifications"),
    where("recipientUid", "==", uid),
    where("read", "==", false),
    orderBy("createdAt", "desc"),
    limit(10),
  );

  let initialIds: Set<string> | null = null;
  let ready = false;

  return onSnapshot(
    q,
    (snap) => {
      if (initialIds === null) {
        initialIds = new Set(snap.docs.map((d) => d.id));
        setTimeout(() => {
          ready = true;
        }, 0);
        return;
      }
      if (!ready) return;

      for (const change of snap.docChanges()) {
        if (change.type === "added" && !initialIds.has(change.doc.id)) {
          const data = change.doc.data();
          onNotification({
            type: data.type ?? "",
            title: data.title ?? "SkateHubba",
            body: data.body ?? "",
            gameId: data.gameId,
          });
          initialIds.add(change.doc.id);

          markNotificationRead(change.doc.id).catch((err) => {
            logger.warn("auto_mark_read_failed", {
              notificationId: change.doc.id,
              error: parseFirebaseError(err),
            });
          });
        }
      }

      if (initialIds.size > 50) {
        initialIds = new Set(Array.from(initialIds).slice(-25));
      }
    },
    (err) => {
      logger.warn("notification_subscription_error", { uid, error: parseFirebaseError(err) });
    },
  );
}
