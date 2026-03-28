import {
  addDoc,
  collection,
  doc,
  getDocs,
  deleteDoc,
  onSnapshot,
  orderBy,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";

export type NotificationDocType = "your_turn" | "new_challenge" | "game_won" | "game_lost";

interface WriteNotificationParams {
  recipientUid: string;
  type: NotificationDocType;
  title: string;
  body: string;
  gameId: string;
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
  try {
    await addDoc(collection(requireDb(), "notifications"), {
      recipientUid: params.recipientUid,
      type: params.type,
      title: params.title,
      body: params.body,
      gameId: params.gameId,
      read: false,
      createdAt: serverTimestamp(),
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

  return onSnapshot(q, (snap) => {
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
  });
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

  return onSnapshot(q, (snap) => {
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

        markNotificationRead(change.doc.id);
      }
    }

    if (initialIds.size > 50) {
      initialIds = new Set(Array.from(initialIds).slice(-25));
    }
  });
}
