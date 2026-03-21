import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";

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
      error: String(err),
    });
  }
}
