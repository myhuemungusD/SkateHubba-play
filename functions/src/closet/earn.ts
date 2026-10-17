/**
 * Closet earn track — award Hubba Bucks when players complete games.
 * Called by the stats close-out function after a game reaches terminal state.
 *
 * NOT DEPLOYED YET — written for structure, will deploy separately.
 */
import { logger } from "firebase-functions/v2";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, type DocumentReference } from "firebase-admin/firestore";

interface AwardEarnParams {
  uid: string;
  event: "game_complete" | "achievement_grant" | "streak_bonus" | "milestone";
  amountBucks: number;
  metadata?: Record<string, unknown>;
}

interface AwardEarnResult {
  newBalance: number;
  earnedBalance: number;
}

/**
 * Award earned Hubba Bucks to a user's wallet.
 * Transactional to ensure balance integrity.
 */
export const awardEarn = onCall<AwardEarnParams, Promise<AwardEarnResult>>(
  { region: "us-central1", enforceAppCheck: true },
  async (request) => {
    const { uid, event, amountBucks, metadata } = request.data;

    if (!uid || typeof uid !== "string") {
      throw new HttpsError("invalid-argument", "uid is required");
    }

    if (!event || typeof event !== "string") {
      throw new HttpsError("invalid-argument", "event is required");
    }

    if (typeof amountBucks !== "number" || amountBucks <= 0 || !Number.isInteger(amountBucks)) {
      throw new HttpsError("invalid-argument", "amountBucks must be a positive integer");
    }

    const db = getFirestore();
    const walletRef = db.doc(`wallet/${uid}`) as DocumentReference;
    const ledgerRef = db.collection(`ledger/${uid}/entries`).doc();

    try {
      await db.runTransaction(async (tx) => {
        const walletSnap = await tx.get(walletRef);
        const currentBalance = walletSnap.exists ? (walletSnap.data()?.balance ?? 0) : 0;
        const currentEarnedBal = walletSnap.exists ? (walletSnap.data()?.earnedBal ?? 0) : 0;

        const newBalance = currentBalance + amountBucks;
        const newEarnedBal = currentEarnedBal + amountBucks;

        tx.set(
          walletRef,
          { balance: newBalance, earnedBal: newEarnedBal, boughtBal: walletSnap.data()?.boughtBal ?? 0 },
          { merge: true },
        );

        tx.set(ledgerRef, {
          uid,
          event,
          amountBucks,
          balanceAfter: newBalance,
          timestamp: FieldValue.serverTimestamp(),
          metadata: metadata ?? null,
        });

        return { newBalance, earnedBalance: newEarnedBal };
      });

      const result = await walletRef.get().then((snap) => ({
        newBalance: snap.data()?.balance ?? 0,
        earnedBalance: snap.data()?.earnedBal ?? 0,
      }));

      logger.info("closet_earn_awarded", { uid, event, amountBucks, newBalance: result.newBalance });

      return result;
    } catch (err) {
      logger.error("closet_earn_award_failed", { uid, event, error: String(err) });
      throw new HttpsError("internal", "Failed to award earn");
    }
  },
);
