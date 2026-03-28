import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  limit,
  query,
  updateDoc,
  where,
  serverTimestamp,
  type QuerySnapshot,
  type DocumentData,
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

/**
 * Subscribe to a user's unread notifications in real time.
 * Returns an unsubscribe function.
 */
export function subscribeToUnreadNotifications(
  uid: string,
  callback: (snap: QuerySnapshot<DocumentData>) => void,
): () => void {
  const q = query(
    collection(requireDb(), "notifications"),
    where("recipientUid", "==", uid),
    where("read", "==", false),
    orderBy("createdAt", "desc"),
    limit(10),
  );
  return onSnapshot(q, callback);
}

/**
 * Mark a notification as read. Best-effort — callers should catch errors.
 */
export async function markNotificationRead(notificationId: string): Promise<void> {
  await updateDoc(doc(requireDb(), "notifications", notificationId), { read: true });
}

/**
 * Delete a single notification document. Only the recipient can delete
 * (enforced by Firestore rules).
 */
export async function deleteNotification(notificationId: string): Promise<void> {
  await deleteDoc(doc(requireDb(), "notifications", notificationId));
}
