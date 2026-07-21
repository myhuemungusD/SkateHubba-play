#!/usr/bin/env node
/**
 * Wins/losses counter recovery — one-time recompute-from-source backfill.
 *
 * A client-side replay bug corrupted every user's `wins` / `losses` counters
 * on `users/{uid}` in production. Client stat writes are being removed; a
 * Cloud Function now applies stats exactly once per terminal game, gated by a
 * `statsApplied` flag on `games/{gameId}`. This script is the one-time
 * recovery: it throws away the corrupted counters and recomputes every user's
 * record from the only source of truth — the terminal game docs themselves.
 *
 * What it does:
 *
 *   1. Reads every game with status in ["complete","forfeit"] (both are
 *      terminal and both count toward W/L). A single collection-wide `in`
 *      query is used and the whole result is held in memory: at this app's
 *      scale the terminal-game set is small enough that a full get is
 *      simpler and cheaper than cursor pagination, and the header note here
 *      is the deliberate record of that trade-off.
 *   2. For each terminal game with a valid winner (a non-empty string equal
 *      to player1Uid or player2Uid), tallies winner wins++ / loser losses++
 *      and queues `statsApplied: true` on the game doc. Games already carrying
 *      `statsApplied` still count toward the tally (the recompute is
 *      authoritative) but skip the redundant write. Games whose winner is
 *      null or does not name one of the two players are SKIPPED-logged with a
 *      reason and are NOT flagged `statsApplied`.
 *   3. Reads every user and OVERWRITES `wins` / `losses` with the tallied
 *      values (0 / 0 when the user has no terminal games — this intentionally
 *      zeroes accounts the corruption inflated). `lastStatsGameId`, a dead
 *      idempotency field superseded by the game-level `statsApplied` flag, is
 *      removed via FieldValue.delete() on the same write.
 *   4. Tallied uids with no surviving user doc (deleted accounts) are logged
 *      as ORPHAN and skipped.
 *
 * Idempotency / safety:
 *
 * - Recompute-from-source, so it is safe to re-run indefinitely. Each run
 *   discards whatever counters exist and rebuilds them from the terminal
 *   games, so a partial first run plus a full second run converges to the
 *   correct state; repeated runs over an unchanging collection are a no-op in
 *   effect.
 * - It converges even if games reach a terminal state mid-run: a game that
 *   completes after this run simply isn't counted yet, and the next run — or
 *   the Cloud Function, going forward — folds it in. Because every run
 *   overwrites counters with a fresh recount rather than incrementing, there
 *   is no double-count window.
 * - The Admin SDK bypasses Firestore security rules, so writing `wins` /
 *   `losses` / `statsApplied` here does not need to satisfy the client-side
 *   constraints those rules enforce.
 *
 * Writes are batched with Firestore `WriteBatch` capped at 400 ops per commit
 * (documented limit is 500; 400 leaves headroom). Both game `statsApplied`
 * flags and user counter overwrites share the same batch stream. Progress is
 * emitted one line per committed batch with a PROCESSED tag.
 *
 * Usage:
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
 *
 *   # Dry run — full scan, per-user before→after diff, summary, zero writes.
 *   node scripts/backfill-stats.mjs --dry-run
 *
 *   # Live run.
 *   node scripts/backfill-stats.mjs
 *
 * Production rollout order (do NOT reorder):
 *
 *   1. Deploy firestore.rules — kills the remaining client stat writes. Old
 *      clients still in the wild issue the write, get permission-denied, and
 *      swallow it gracefully (no user-visible error).
 *   2. Deploy the Cloud Function — from here forward stats are applied once
 *      per terminal game, gated by `statsApplied`.
 *   3. Deploy the client — removes the client stat-write code entirely.
 *   4. Run this script (--dry-run first, verify the summary, then live) — it
 *      repairs the historical corruption the steps above stopped from growing.
 */

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const FIRESTORE_DB_ID = "skatehubba";
const BATCH_SIZE = 400;
const TERMINAL_STATUSES = ["complete", "forfeit"];

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");

function initAdmin() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    const serviceAccount = JSON.parse(readFileSync(credPath, "utf-8"));
    initializeApp({ credential: cert(serviceAccount) });
  } else {
    // Falls back to application-default credentials (e.g. on a GCP host).
    // Fails loudly if none are available.
    initializeApp();
  }
  return getFirestore(FIRESTORE_DB_ID);
}

/** Increment a win or loss for a uid in the running tally map. */
function bump(tally, uid, key) {
  let rec = tally.get(uid);
  if (!rec) {
    rec = { wins: 0, losses: 0 };
    tally.set(uid, rec);
  }
  rec[key] += 1;
}

/**
 * Validate the winner field of a terminal game. Returns null when valid,
 * otherwise a short reason string for the SKIPPED log.
 */
function winnerProblem(winner, p1, p2) {
  if (winner === null || winner === undefined) return "winner-null";
  if (typeof winner !== "string" || winner.length === 0) return "winner-invalid-type";
  if (winner !== p1 && winner !== p2) return "winner-not-a-player";
  return null;
}

/**
 * Shared batch stream. Queues writes and commits at BATCH_SIZE, tracking how
 * many batches were committed. A no-op collector in dry-run mode.
 */
function createBatchStream(db) {
  let batch = db.batch();
  let opsInBatch = 0;
  let batchesCommitted = 0;
  let opsCommitted = 0;

  return {
    async queue(apply) {
      if (DRY_RUN) return;
      apply(batch);
      opsInBatch += 1;
      if (opsInBatch >= BATCH_SIZE) {
        await batch.commit();
        batchesCommitted += 1;
        opsCommitted += opsInBatch;
        console.log(`PROCESSED batch committed batches=${batchesCommitted} ops=${opsCommitted}`);
        batch = db.batch();
        opsInBatch = 0;
      }
    },
    async flush() {
      if (DRY_RUN || opsInBatch === 0) return;
      await batch.commit();
      batchesCommitted += 1;
      opsCommitted += opsInBatch;
      console.log(`PROCESSED final batch committed batches=${batchesCommitted} ops=${opsCommitted}`);
      opsInBatch = 0;
    },
    get batchesCommitted() {
      return batchesCommitted;
    },
  };
}

async function backfill(db) {
  console.log(`backfill-stats: starting (dryRun=${DRY_RUN})`);

  const stream = createBatchStream(db);
  const tally = new Map();

  /* ── Phase 1: recompute tally from terminal games ───────────────────── */
  console.log(`backfill-stats: scanning games where status in [${TERMINAL_STATUSES.join(", ")}]...`);
  const gamesSnap = await db.collection("games").where("status", "in", TERMINAL_STATUSES).get();
  console.log(`backfill-stats: found ${gamesSnap.size} terminal game docs`);

  let gamesScanned = 0;
  let gamesCounted = 0;
  let gamesSkipped = 0;
  let statsFlagged = 0;
  let alreadyFlagged = 0;

  for (const gameDoc of gamesSnap.docs) {
    gamesScanned += 1;
    const data = gameDoc.data();
    const p1 = data.player1Uid;
    const p2 = data.player2Uid;
    const winner = data.winner;

    const problem = winnerProblem(winner, p1, p2);
    if (problem) {
      gamesSkipped += 1;
      console.log(`SKIPPED game=${gameDoc.id} reason=${problem}`);
      continue;
    }

    const loser = winner === p1 ? p2 : p1;
    bump(tally, winner, "wins");
    bump(tally, loser, "losses");
    gamesCounted += 1;

    if (data.statsApplied === true) {
      // Recompute already accounted for this game; the flag write is redundant.
      alreadyFlagged += 1;
      continue;
    }
    statsFlagged += 1;
    await stream.queue((batch) => batch.update(gameDoc.ref, { statsApplied: true }));
  }

  /* ── Phase 2: overwrite every user's counters from the tally ────────── */
  console.log("backfill-stats: scanning users collection...");
  const usersSnap = await db.collection("users").get();
  console.log(`backfill-stats: found ${usersSnap.size} user docs`);

  const seenUids = new Set();
  let usersUpdated = 0;
  let usersZeroed = 0;

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    seenUids.add(uid);

    const rec = tally.get(uid);
    const afterWins = rec ? rec.wins : 0;
    const afterLosses = rec ? rec.losses : 0;

    if (rec) usersUpdated += 1;
    else usersZeroed += 1;

    if (DRY_RUN) {
      const cur = userDoc.data();
      const beforeWins = typeof cur.wins === "number" ? cur.wins : 0;
      const beforeLosses = typeof cur.losses === "number" ? cur.losses : 0;
      console.log(
        `PLAN user=${uid} wins:${beforeWins}→${afterWins} losses:${beforeLosses}→${afterLosses}` +
          (rec ? "" : " (zeroed)"),
      );
      continue;
    }

    await stream.queue((batch) =>
      batch.update(userDoc.ref, {
        wins: afterWins,
        losses: afterLosses,
        lastStatsGameId: FieldValue.delete(),
      }),
    );
  }

  await stream.flush();

  /* ── Phase 3: report tallied uids with no surviving user doc ─────────── */
  let orphaned = 0;
  for (const uid of tally.keys()) {
    if (!seenUids.has(uid)) {
      orphaned += 1;
      const rec = tally.get(uid);
      console.log(`ORPHAN uid=${uid} wins=${rec.wins} losses=${rec.losses} (no user doc — skipped)`);
    }
  }

  /* ── Summary ─────────────────────────────────────────────────────────── */
  console.log("");
  console.log(`===== BACKFILL-STATS SUMMARY (dryRun=${DRY_RUN}) =====`);
  console.log(`games scanned:      ${gamesScanned}`);
  console.log(`games counted:      ${gamesCounted}  (valid winner, tallied)`);
  console.log(`games skipped:      ${gamesSkipped}  (null/invalid winner)`);
  console.log(`games statsApplied: ${statsFlagged}  (newly flagged; already flagged: ${alreadyFlagged})`);
  console.log(`users updated:      ${usersUpdated}  (had tallied stats)`);
  console.log(`users zeroed:       ${usersZeroed}  (no terminal games)`);
  console.log(`users orphaned:     ${orphaned}  (tallied but no user doc — skipped)`);
  console.log(`batches committed:  ${stream.batchesCommitted}`);
  console.log("======================================================");
}

(async () => {
  const db = initAdmin();
  try {
    await backfill(db);
    process.exit(0);
  } catch (err) {
    console.error("backfill-stats: failed", err);
    process.exit(1);
  }
})();
