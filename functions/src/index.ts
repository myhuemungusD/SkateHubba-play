import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

initializeApp();

const DB_NAME = "skatehubba";

/* ── Helpers ─────────────────────────────────────────────────── */

/** Fetch FCM tokens for a user. Returns empty array if none found. */
async function getFcmTokens(uid: string): Promise<string[]> {
  const db = getFirestore(DB_NAME);
  const snap = await db.doc(`users/${uid}`).get();
  return snap.data()?.fcmTokens ?? [];
}

/** Send a push notification and clean up stale tokens. Returns success count. */
async function sendPush(
  recipientUid: string,
  tokens: string[],
  notification: { title: string; body: string },
  data: Record<string, string>,
): Promise<number> {
  if (tokens.length === 0) return 0;

  const response = await getMessaging().sendEachForMulticast({
    notification,
    data,
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
    const db = getFirestore(DB_NAME);
    await db.doc(`users/${recipientUid}`).update({
      fcmTokens: FieldValue.arrayRemove(...invalidTokens),
    });
  }

  return response.successCount;
}

/* ── Nudge notifications (existing) ──────────────────────────── */

/**
 * Triggered when a new nudge document is created in Firestore.
 * Sends a push notification to the recipient via FCM.
 */
export const onNudgeCreated = onDocumentCreated({ document: "nudges/{nudgeId}", database: DB_NAME }, async (event) => {
  const data = event.data?.data();
  if (!data) return;

  const { recipientUid, senderUsername, gameId } = data;
  const tokens = await getFcmTokens(recipientUid);

  const successCount = await sendPush(
    recipientUid,
    tokens,
    {
      title: "You got nudged! 👊",
      body: `@${senderUsername} is waiting for your move`,
    },
    { gameId, type: "nudge", nudgeId: event.data?.id ?? "" },
  );

  await event.data?.ref.update({ delivered: successCount > 0 });
});

/* ── New challenge notifications ─────────────────────────────── */

/**
 * When a new game is created, notify player2 (the challenged player)
 * via push notification so they know even if the app is closed.
 */
export const onGameCreated = onDocumentCreated({ document: "games/{gameId}", database: DB_NAME }, async (event) => {
  const data = event.data?.data();
  if (!data) return;

  const { player2Uid, player1Username } = data;
  const gameId = event.params.gameId;

  const tokens = await getFcmTokens(player2Uid);
  await sendPush(
    player2Uid,
    tokens,
    {
      title: "New Challenge! 🛹",
      body: `@${player1Username} challenged you to S.K.A.T.E.`,
    },
    { gameId, type: "new_challenge" },
  );
});

/* ── Turn change / game completion notifications ─────────────── */

/**
 * When a game document is updated, detect turn changes, phase changes,
 * and game completions — then push-notify the relevant player.
 */
export const onGameUpdated = onDocumentUpdated({ document: "games/{gameId}", database: DB_NAME }, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;

  const gameId = event.params.gameId;

  const opponentName = (uid: string) => (after.player1Uid === uid ? after.player2Username : after.player1Username);

  // ── Game completed ──
  if (after.status !== "active" && before.status === "active") {
    const isForfeit = after.status === "forfeit";
    const winnerUid: string | null = after.winner;

    // Notify both players
    const players = [
      { uid: after.player1Uid, name: after.player1Username },
      { uid: after.player2Uid, name: after.player2Username },
    ];

    await Promise.all(
      players.map(async (player) => {
        const tokens = await getFcmTokens(player.uid);
        const won = winnerUid === player.uid;
        await sendPush(
          player.uid,
          tokens,
          {
            title: won
              ? isForfeit
                ? "Opponent Forfeited! 🏆"
                : "You Won! 🏆"
              : isForfeit
                ? "Time Expired ⏰"
                : "Game Over",
            body: `vs @${opponentName(player.uid)}`,
          },
          { gameId, type: won ? "game_won" : "game_lost" },
        );
      }),
    );
    return;
  }

  // ── Turn changed ──
  if (after.currentTurn !== before.currentTurn && after.status === "active") {
    const recipientUid = after.currentTurn;
    const tokens = await getFcmTokens(recipientUid);

    if (after.phase === "matching") {
      await sendPush(
        recipientUid,
        tokens,
        {
          title: "Your Turn! 🎯",
          body: `Match @${opponentName(recipientUid)}'s ${after.currentTrickName || "trick"}`,
        },
        { gameId, type: "your_turn" },
      );
    } else if (after.phase === "setting") {
      await sendPush(
        recipientUid,
        tokens,
        {
          title: "Your Turn to Set! 🛹",
          body: `Set a trick for @${opponentName(recipientUid)}`,
        },
        { gameId, type: "your_turn" },
      );
    }
    return;
  }
});
