import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineBoolean, defineString } from "firebase-functions/params";
import { applyGameStats } from "./applyGameStats.js";
import { handleDiceCall } from "./dice/callable.js";
import { sweepExpiredDiceGames } from "./dice/handlers.js";
import { adminDiceDb } from "./dice/store.js";

/**
 * The app uses the named Firestore database "skatehubba", NOT the (default)
 * database. Every trigger binding and every getFirestore() call must target it
 * explicitly or reads/writes silently hit the wrong (empty) database.
 */
const DATABASE_ID = "skatehubba";

// Initialize the admin app exactly once for the whole functions runtime.
initializeApp();

/**
 * Reconcile win/loss counters when a game reaches a terminal state.
 *
 * Fires on every games/{gameId} update but fast-returns unless the doc is a
 * freshly-terminal, winner-bearing game whose stats have not yet been applied.
 * The authoritative idempotency guard lives inside applyGameStats' transaction;
 * this pre-check only avoids opening a transaction for unrelated updates.
 */
export const onGameCompleted = onDocumentUpdated(
  { document: "games/{gameId}", database: DATABASE_ID, region: "us-central1" },
  async (event): Promise<void> => {
    const after = event.data?.after.data();
    if (!after) return;

    const status = after.status;
    const winner = after.winner;
    const isTerminal = status === "complete" || status === "forfeit";
    const hasWinner = typeof winner === "string" && winner.length > 0;

    if (!isTerminal || !hasWinner || after.statsApplied === true) return;

    await applyGameStats(getFirestore(DATABASE_ID), event.params.gameId);
  },
);

/**
 * Roll Dice kill switch. Default off. While off, only uids in
 * DICE_TESTER_UIDS (comma-separated) can call. Set both at deploy time;
 * they are not read from the client.
 */
const diceEnabled = defineBoolean("DICE_ENABLED", { default: false });
const diceTesterUids = defineString("DICE_TESTER_UIDS", { default: "" });

/**
 * The only client entry for Roll Dice. App Check is monitored, not enforced,
 * until Firestore enforcement is turned on (see docs/APPCHECK_ROLLOUT.md).
 */
export const diceAction = onCall({ region: "us-central1", enforceAppCheck: false }, (request) =>
  handleDiceCall(request, {
    enabled: diceEnabled.value(),
    testers: diceTesterUids.value(),
    nowMs: Date.now(),
    db: adminDiceDb(getFirestore(DATABASE_ID)),
  }),
);

/** Backstop for expired dice turns. Same decision as claimTimeout. */
export const diceSweep = onSchedule({ schedule: "every 15 minutes", region: "us-central1" }, async () => {
  await sweepExpiredDiceGames(adminDiceDb(getFirestore(DATABASE_ID)), Date.now());
});
