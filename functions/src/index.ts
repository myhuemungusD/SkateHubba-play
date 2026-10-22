import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { setGlobalOptions, type GlobalOptions } from "firebase-functions/v2";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineBoolean, defineInt, defineSecret, defineString } from "firebase-functions/params";
import { getMessaging } from "firebase-admin/messaging";
import { deliverDispatch, drainQueue } from "./push/drain.js";
import { refereesDue, runReferees } from "./push/referees.js";
import { adminDrainDeps, readQueue, toQueuedDoc } from "./push/store.js";
import { applyGameStats } from "./applyGameStats.js";
import { handleDiceCall } from "./dice/callable.js";
import { sweepExpiredDiceGames } from "./dice/handlers.js";
import { adminDiceDb } from "./dice/store.js";
import { handleCheckinCall, handlePresenceCall } from "./map/callable.js";
import { handleBlessingCall } from "./pro/callable.js";
import { handleProSeedCall } from "./pro/seed.js";
import { fanOutAnnouncement } from "./admin/announce.js";
import { handleAnalyticsCall } from "./admin/analytics.js";
import { applyProCall } from "./pro/proCalls.js";
import { handleClipCreated, handleClipReport, handleDecideClip } from "./moderation/handlers.js";
import { adminClipStore } from "./moderation/publish.js";
import type { ClosetFlags } from "./closet/access.js";
import { runDueDraws } from "./closet/draws.js";
import {
  handleAwardEarn,
  handleBuyShopItem,
  handleClaimDrop,
  handleClosetAdmin,
  handleConfirmTrade,
  handleEnterDraw,
  handleEquipItem,
  handleGameEarn,
  handleIapVerify,
  handleProposeTrade,
  handleRespondTrade,
  type ClosetDeps,
} from "./closet/handlers.js";
import { adminClosetDb } from "./closet/store.js";
import { releaseTradeHolds as sweepTradeHolds } from "./closet/trading.holds.js";

/**
 * Shared defaults for every v2 function in this file.
 *
 * `setGlobalOptions` replaces the defaults bag, so the runtime account is
 * spread onto the options already shared by every export (region) instead of
 * passed alone. Per-function options override a single field. None of the
 * exports set `serviceAccount`, so the callables (`diceAction`,
 * `decideClipModeration`), the schedule (`diceSweep`), and the Firestore
 * triggers (`onGameCompleted`, `moderateNewClip`, `moderateClipReport`) all
 * inherit this account.
 *
 * The default Compute Engine service account
 * (`665573979824-compute@developer.gserviceaccount.com`) was deleted on
 * sk8hub-d7806. A deploy that leaves the runtime identity unset fails with
 * "Service account ... was not found". Live functions already run as the
 * App Engine default account, and the deployer has
 * `roles/iam.serviceAccountUser` on it.
 */
const globalOptions: GlobalOptions = {
  region: "us-central1",
};

setGlobalOptions({
  ...globalOptions,
  serviceAccount: "sk8hub-d7806@appspot.gserviceaccount.com",
});

/**
 * The app uses the named Firestore database "skatehubba", NOT the (default)
 * database. Every trigger binding and every getFirestore() call must target it
 * explicitly or reads/writes silently hit the wrong (empty) database.
 */
const DATABASE_ID = "skatehubba";

// Initialize the admin app exactly once for the whole functions runtime.
initializeApp();

/**
 * XP kill switch. Default off. While off, only uids in XP_TESTER_UIDS
 * (comma-separated) earn XP on their own side of a close-out. Set both at
 * deploy time; they are not read from the client. See docs/XP_LEVELS.md.
 */
const xpEnabled = defineBoolean("XP_ENABLED", { default: false });
const xpTesterUids = defineString("XP_TESTER_UIDS", { default: "" });

/**
 * Closet kill switches. All default off. CLOSET_ENABLED is the master
 * switch; drops, trading and buying Bucks each need their own flag on top.
 * Uids in CLOSET_TESTER_UIDS get every closet feature while flags are off.
 * See functions/src/closet/access.ts.
 */
const closetEnabled = defineBoolean("CLOSET_ENABLED", { default: false });
const closetDropsEnabled = defineBoolean("CLOSET_DROPS_ENABLED", { default: false });
const closetTradingEnabled = defineBoolean("CLOSET_TRADING_ENABLED", { default: false });
const closetBucksPurchaseEnabled = defineBoolean("CLOSET_BUCKS_PURCHASE_ENABLED", { default: false });
const closetTesterUids = defineString("CLOSET_TESTER_UIDS", { default: "" });

function closetFlags(): ClosetFlags {
  return {
    enabled: closetEnabled.value(),
    drops: closetDropsEnabled.value(),
    trading: closetTradingEnabled.value(),
    bucksPurchase: closetBucksPurchaseEnabled.value(),
    testers: closetTesterUids.value(),
  };
}

function closetDeps(): ClosetDeps {
  return { flags: closetFlags(), nowMs: Date.now(), db: adminClosetDb(getFirestore(DATABASE_ID)) };
}

/**
 * Reconcile win/loss counters when a game reaches a terminal state.
 *
 * Fires on every games/{gameId} update but fast-returns unless the doc is a
 * freshly-terminal, winner-bearing game whose stats have not yet been applied.
 * The authoritative idempotency guard lives inside applyGameStats' transaction;
 * this pre-check only avoids opening a transaction for unrelated updates.
 */
export const onGameCompleted = onDocumentUpdated(
  {
    document: "games/{gameId}",
    database: DATABASE_ID,
    region: "us-central1",
    // A thrown close-out is retried. applyGameStats re-checks statsApplied
    // inside the transaction, so a second run does not award twice.
    retry: true,
  },
  async (event): Promise<void> => {
    const after = event.data?.after.data();
    if (!after) return;

    const status = after.status;
    const winner = after.winner;
    const isTerminal = status === "complete" || status === "forfeit";
    const hasWinner = typeof winner === "string" && winner.length > 0;

    if (!isTerminal || !hasWinner || after.statsApplied === true) return;

    await applyGameStats(getFirestore(DATABASE_ID), event.params.gameId, {
      enabled: xpEnabled.value(),
      testers: xpTesterUids.value(),
    });
    await handleGameEarn(
      adminClosetDb(getFirestore(DATABASE_ID)),
      closetFlags(),
      event.params.gameId,
      after,
      Date.now(),
    );
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

/**
 * Map check-ins kill switch (docs/MAP_ROADMAP.md Phase 1). Default off. While
 * off, only uids in MAP_TESTER_UIDS can check in.
 */
const mapCheckinsEnabled = defineBoolean("MAP_CHECKINS_ENABLED", { default: false });
const mapTesterUids = defineString("MAP_TESTER_UIDS", { default: "" });

/** The only write path for check-ins, passport stamps and legendary badges. */
export const mapCheckin = onCall({ region: "us-central1", enforceAppCheck: false }, (request) =>
  handleCheckinCall(request, {
    enabled: mapCheckinsEnabled.value(),
    testers: mapTesterUids.value(),
    xpEnabled: xpEnabled.value(),
    xpTesters: xpTesterUids.value(),
    nowMs: Date.now(),
    db: adminDiceDb(getFirestore(DATABASE_ID)),
  }),
);

/**
 * Spot presence (who is at a spot right now). Default off. While off, only
 * uids in SPOT_PRESENCE_TESTER_UIDS can send heartbeats.
 */
const spotPresenceEnabled = defineBoolean("SPOT_PRESENCE_ENABLED", { default: false });
const spotPresenceTesterUids = defineString("SPOT_PRESENCE_TESTER_UIDS", { default: "" });

/** The only write path for spotPresence/{spotId}/here/{uid}. */
export const mapPresence = onCall({ region: "us-central1", enforceAppCheck: false }, (request) =>
  handlePresenceCall(request, {
    enabled: spotPresenceEnabled.value(),
    testers: spotPresenceTesterUids.value(),
    nowMs: Date.now(),
    db: adminDiceDb(getFirestore(DATABASE_ID)),
  }),
);

/** Backstop for expired dice turns. Same decision as claimTimeout. */
export const diceSweep = onSchedule({ schedule: "every 15 minutes", region: "us-central1" }, async () => {
  await sweepExpiredDiceGames(adminDiceDb(getFirestore(DATABASE_ID)), Date.now());
});

/**
 * Pro blessing kill switch. Default off. While off, only uids in
 * PRO_BLESSING_TESTER_UIDS can bless or answer a blessing; admin revoke
 * always works. A pro badge cannot be earned: this callable is the only
 * non-admin path that sets isVerifiedPro. See docs/PRO_BLESSING.md.
 */
const proBlessingEnabled = defineBoolean("PRO_BLESSING_ENABLED", { default: false });
const proBlessingTesterUids = defineString("PRO_BLESSING_TESTER_UIDS", { default: "" });
const proBlessingLimit = defineInt("PRO_BLESSING_LIMIT", { default: 2 });
const proBlessingWindowDays = defineInt("PRO_BLESSING_WINDOW_DAYS", { default: 30 });
const proBlessingMinAccountDays = defineInt("PRO_BLESSING_MIN_ACCOUNT_DAYS", { default: 30 });

/**
 * Admin-only Verified-Pro seeding with required reason + evidence and an
 * append-only `proAudit` row (security audit 2026-10-21). Replaces the
 * direct client write rules branch. Admin claim + App Check enforced.
 */
export const proSeed = onCall({ region: "us-central1", enforceAppCheck: true }, (request) =>
  handleProSeedCall(request, { db: adminDiceDb(getFirestore(DATABASE_ID)), nowMs: Date.now() }),
);

export const proBlessing = onCall({ region: "us-central1", enforceAppCheck: false }, (request) =>
  handleBlessingCall(request, {
    enabled: proBlessingEnabled.value(),
    testers: proBlessingTesterUids.value(),
    nowMs: Date.now(),
    db: adminDiceDb(getFirestore(DATABASE_ID)),
    config: {
      limit: proBlessingLimit.value(),
      windowDays: proBlessingWindowDays.value(),
      minAccountAgeDays: proBlessingMinAccountDays.value(),
      offerTtlDays: 14,
    },
  }),
);

/**
 * Public-clip screener. Default off. While off, pending clips are left
 * alone (the client flag stays off too, so new clips are not pending).
 * Video Intelligence can run for a few minutes on a short clip.
 */
const moderationEnabled = defineBoolean("MODERATION_ENABLED", { default: false });
const moderationSentryDsn = defineString("SENTRY_DSN", { default: "" });

export const moderateNewClip = onDocumentCreated(
  {
    document: "clips/{clipId}",
    database: DATABASE_ID,
    region: "us-central1",
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async (event): Promise<void> => {
    await handleClipCreated(
      {
        db: getFirestore(DATABASE_ID),
        enabled: moderationEnabled.value(),
        sentryDsn: moderationSentryDsn.value(),
        media: adminClipStore(),
      },
      event.params.clipId,
      event.data?.data(),
    );
  },
);

/** Count distinct reporters and auto-hide a public clip once the threshold is met. */
export const moderateClipReport = onDocumentCreated(
  { document: "reports/{reportId}", database: DATABASE_ID, region: "us-central1", timeoutSeconds: 60 },
  async (event): Promise<void> => {
    await handleClipReport(
      {
        db: getFirestore(DATABASE_ID),
        enabled: moderationEnabled.value(),
        sentryDsn: moderationSentryDsn.value(),
        media: adminClipStore(),
      },
      event.data?.data(),
      Date.now(),
    );
  },
);

/**
 * Admin keep / remove. Not gated by MODERATION_ENABLED so a clip already in
 * review can still be cleared after the screener is switched off.
 */
export const decideClipModeration = onCall({ region: "us-central1", enforceAppCheck: false }, (request) =>
  handleDecideClip(request, getFirestore(DATABASE_ID), adminClipStore()),
);

/**
 * Closet callables. App Check is enforced on every one (plan §9): unlike the
 * older callables these launch dark, so there is no legacy client to keep
 * working without a token. Nothing here writes from the client; every mint,
 * spend and swap is a server transaction.
 */
const closetCallable = { region: "us-central1", enforceAppCheck: true } as const;

export const claimDrop = onCall(closetCallable, (request) => handleClaimDrop(request, closetDeps()));
export const enterDraw = onCall(closetCallable, (request) => handleEnterDraw(request, closetDeps()));
export const buyShopItem = onCall(closetCallable, (request) => handleBuyShopItem(request, closetDeps()));
export const awardEarn = onCall(closetCallable, (request) => handleAwardEarn(request, closetDeps()));
export const proposeTrade = onCall(closetCallable, (request) => handleProposeTrade(request, closetDeps()));
export const respondTrade = onCall(closetCallable, (request) => handleRespondTrade(request, closetDeps()));
export const confirmTrade = onCall(closetCallable, (request) => handleConfirmTrade(request, closetDeps()));
export const equipItem = onCall(closetCallable, (request) => handleEquipItem(request, closetDeps()));
export const iapVerify = onCall(closetCallable, (request) => handleIapVerify(request, closetDeps()));
export const closetAdmin = onCall(closetCallable, (request) => handleClosetAdmin(request, closetDeps()));

/** Close Grail draws whose entry window ended. No-op while no draw drops exist. */
export const runDraw = onSchedule({ schedule: "every 15 minutes", region: "us-central1" }, async () => {
  await runDueDraws(adminClosetDb(getFirestore(DATABASE_ID)), Date.now());
});

/** Deliver trades whose 3-day hold has passed. No-op while trading is off. */
export const releaseTradeHolds = onSchedule({ schedule: "every 60 minutes", region: "us-central1" }, async () => {
  await sweepTradeHolds(adminClosetDb(getFirestore(DATABASE_ID)), Date.now());
});

/**
 * Push courier (replaces the GitHub Actions "Drain Push Dispatch" cron,
 * approved 2026-10-17). Sends a push the moment its /push_dispatch doc is
 * created. No platform retry: a failed send stays queued and the scheduled
 * pass below picks it up. See functions/src/push/drain.ts.
 */
export const pushDispatchOnCreate = onDocumentCreated(
  { document: "push_dispatch/{dispatchId}", database: DATABASE_ID, region: "us-central1", timeoutSeconds: 60 },
  async (event): Promise<void> => {
    if (!event.data) return;
    const db = getFirestore(DATABASE_ID);
    await deliverDispatch(toQueuedDoc(event.data), adminDrainDeps(db, getMessaging(), Date.now()));
  },
);

/** CRON_SECRET shared with the Vercel referee endpoints (Secret Manager). */
const cronSecret = defineSecret("CRON_SECRET");

/**
 * Every 5 minutes: retry anything still queued (older than 2 minutes, so it
 * never races the create trigger), and every 15 minutes call the turn and
 * dispute referee endpoints on Vercel.
 */
export const pushDispatchSweep = onSchedule(
  { schedule: "every 5 minutes", region: "us-central1", timeoutSeconds: 540, secrets: [cronSecret] },
  async (): Promise<void> => {
    const nowMs = Date.now();
    const db = getFirestore(DATABASE_ID);
    const summary = await drainQueue(await readQueue(db), adminDrainDeps(db, getMessaging(), nowMs));
    console.log(JSON.stringify({ event: "push_sweep", ...summary }));
    if (refereesDue(nowMs)) {
      const results = await runReferees(cronSecret.value(), fetch, (e, f) =>
        console.warn(JSON.stringify({ event: e, ...f })),
      );
      console.log(JSON.stringify({ event: "referees", results }));
    }
  },
);

/** Admin announcement with push on: queue one push per recipient. */
export const announcementOnCreate = onDocumentCreated(
  { document: "announcements/{id}", database: DATABASE_ID, region: "us-central1", timeoutSeconds: 300 },
  async (event): Promise<void> => {
    await fanOutAnnouncement(getFirestore(DATABASE_ID), event.params.id, event.data?.data());
  },
);

/** Admin-claim-only analytics snapshot. */
export const adminAnalytics = onCall(
  { region: "us-central1", enforceAppCheck: false, timeoutSeconds: 120 },
  (request) => handleAnalyticsCall(request, getFirestore(DATABASE_ID), Date.now()),
);

/** A verified pro's review of a split WTT vote becomes the clip's gold label. */
export const proReviewOnCreate = onDocumentCreated(
  { document: "proReviews/{reviewId}", database: DATABASE_ID, region: "us-central1", timeoutSeconds: 60 },
  async (event): Promise<void> => {
    await applyProCall(getFirestore(DATABASE_ID), "review", event.data?.data());
  },
);

/** A verified pro's known-correct trick on a clip becomes its gold label. */
export const proGoldOnCreate = onDocumentCreated(
  { document: "proGold/{clipId}", database: DATABASE_ID, region: "us-central1", timeoutSeconds: 60 },
  async (event): Promise<void> => {
    await applyProCall(getFirestore(DATABASE_ID), "gold", event.data?.data());
  },
);
