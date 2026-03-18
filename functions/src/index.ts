import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

initializeApp();

/**
 * Triggered when a new nudge document is created in Firestore.
 * Sends a push notification to the recipient via FCM.
 */
export const onNudgeCreated = onDocumentCreated(
  { document: "nudges/{nudgeId}", database: "skatehubba" },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const { recipientUid, senderUsername, gameId } = data;
    const db = getFirestore("skatehubba");

    // Get recipient's FCM tokens
    const userDoc = await db.doc(`users/${recipientUid}`).get();
    const userData = userDoc.data();
    const tokens: string[] = userData?.fcmTokens ?? [];

    if (tokens.length === 0) {
      await event.data?.ref.update({ delivered: false });
      return;
    }

    const response = await getMessaging().sendEachForMulticast({
      notification: {
        title: "You got nudged!",
        body: `@${senderUsername} is waiting for your move`,
      },
      data: { gameId, type: "nudge" },
      tokens,
    });

    // Clean up invalid tokens
    const invalidTokens: string[] = [];
    response.responses.forEach((resp, i) => {
      if (
        resp.error?.code === "messaging/invalid-registration-token" ||
        resp.error?.code === "messaging/registration-token-not-registered"
      ) {
        invalidTokens.push(tokens[i]);
      }
    });

    if (invalidTokens.length > 0) {
      await db.doc(`users/${recipientUid}`).update({
        fcmTokens: FieldValue.arrayRemove(...invalidTokens),
      });
    }

    await event.data?.ref.update({ delivered: response.successCount > 0 });
  },
);
