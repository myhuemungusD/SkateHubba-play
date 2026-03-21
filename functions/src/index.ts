import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
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

    // ── Update win/loss stats server-side ──
    // Covers all game-end paths including server-triggered forfeits
    // where no client is online to call updatePlayerStats.
    // Uses lastStatsGameId as idempotency key so client-side calls
    // that already ran won't double-count.
    if (winnerUid) {
      const db = getFirestore(DB_NAME);
      const loserUid = winnerUid === after.player1Uid ? after.player2Uid : after.player1Uid;

      await Promise.all(
        [
          { uid: winnerUid, field: "wins" },
          { uid: loserUid, field: "losses" },
        ].map(async ({ uid, field }) => {
          const userRef = db.doc(`users/${uid}`);
          await db.runTransaction(async (tx) => {
            const snap = await tx.get(userRef);
            if (!snap.exists) return;
            const data = snap.data()!;
            if (data.lastStatsGameId === gameId) return; // already counted
            const current = typeof data[field] === "number" ? (data[field] as number) : 0;
            tx.update(userRef, {
              [field]: current + 1,
              lastStatsGameId: gameId,
            });
          });
        }),
      );
    }

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

/* ── Billing budget alert handler ────────────────────────────── */

/**
 * Pub/Sub-triggered function that fires when a Google Cloud billing
 * budget threshold is crossed.  Configure the budget + Pub/Sub topic
 * via:  bash scripts/setup-billing-alerts.sh
 *
 * The function logs the alert and writes it to the "billingAlerts"
 * Firestore collection so the ops team can query it from the admin
 * dashboard or set up further notification rules.
 */
interface BudgetAlert {
  budgetDisplayName: string;
  costAmount: number;
  budgetAmount: number;
  currencyCode: string;
  alertThresholdExceeded?: number;
  costIntervalStart: string;
}

export const onBillingAlert = onMessagePublished({ topic: "firebase-billing-alerts" }, async (event) => {
  const data: BudgetAlert =
    typeof event.data.message.json === "string" ? JSON.parse(event.data.message.json) : event.data.message.json;

  const pct = data.alertThresholdExceeded ? `${(data.alertThresholdExceeded * 100).toFixed(0)}%` : "unknown";

  logger.warn("🚨 Billing alert received", {
    budget: data.budgetDisplayName,
    thresholdExceeded: pct,
    cost: `${data.costAmount} ${data.currencyCode}`,
    budgetLimit: `${data.budgetAmount} ${data.currencyCode}`,
  });

  // Persist alert to Firestore for audit trail / admin dashboard
  const db = getFirestore(DB_NAME);
  await db.collection("billingAlerts").add({
    ...data,
    thresholdPercent: pct,
    receivedAt: FieldValue.serverTimestamp(),
  });
});

/* ── Server-side turn timer enforcement ────────────────────── */

/**
 * Scheduled function that runs every 15 minutes to auto-forfeit games
 * where the turn deadline has expired. This ensures forfeits happen
 * regardless of whether either player's client is online.
 *
 * Without this, a player can dodge losses by staying offline — the
 * forfeit only triggers when the opponent opens the app.
 */
export const checkExpiredTurns = onSchedule("every 15 minutes", async () => {
  const db = getFirestore(DB_NAME);
  const now = new Date();

  const expiredGames = await db
    .collection("games")
    .where("status", "==", "active")
    .where("turnDeadline", "<=", now)
    .get();

  if (expiredGames.empty) {
    logger.info("checkExpiredTurns: no expired games found");
    return;
  }

  logger.info(`checkExpiredTurns: found ${expiredGames.size} expired game(s)`);

  const results = await Promise.allSettled(
    expiredGames.docs.map(async (doc) => {
      const game = doc.data();
      const currentTurn: string = game.currentTurn;

      // Winner is the opponent of whoever's turn expired
      const winner = currentTurn === game.player1Uid ? game.player2Uid : game.player1Uid;

      await doc.ref.update({
        status: "forfeit",
        winner,
        updatedAt: FieldValue.serverTimestamp(),
      });

      logger.info("checkExpiredTurns: forfeited game", {
        gameId: doc.id,
        timedOutPlayer: currentTurn,
        winner,
      });
    }),
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    logger.error(`checkExpiredTurns: ${failed}/${expiredGames.size} forfeit(s) failed`);
  }
});
