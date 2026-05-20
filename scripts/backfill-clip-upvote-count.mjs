#!/usr/bin/env node
/**
 * Clip upvoteCount aggregate — one-off backfill.
 *
 * The `upvoteCount` aggregate field on `clips/{clipId}` is maintained going
 * forward by the same `runTransaction` that writes a `clipVotes/{uid_clipId}`
 * doc (see src/services/clips.ts → upvoteClip). Existing clips that pre-date
 * the aggregate do not have the field set, so this script seeds it once by
 * counting each clip's matching `clipVotes` entries and writing the result.
 *
 * Properties:
 *
 * - Idempotent — safe to re-run. Each clip's upvoteCount is overwritten with
 *   the freshly-counted value, so a partial first run plus a complete second
 *   run converges to the correct state. Repeated runs against an unchanging
 *   collection are a no-op in effect (counts come out the same).
 *
 * - Batched — writes use Firestore `WriteBatch` capped at 400 ops per commit
 *   (Firestore's documented per-batch limit is 500; 400 leaves headroom for
 *   future fields without rewriting the batch logic).
 *
 * - Progress-logged — one line per processed batch with a PROCESSED tag.
 *
 * Usage:
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
 *
 *   # Dry run — counts every clip's votes and reports planned writes
 *   # without committing.
 *   node scripts/backfill-clip-upvote-count.mjs --dry-run
 *
 *   # Live run.
 *   node scripts/backfill-clip-upvote-count.mjs
 *
 * The Admin SDK bypasses Firestore security rules, so this script can write
 * `upvoteCount` directly without satisfying the ±1 delta constraint enforced
 * on client writes.
 */

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const FIRESTORE_DB_ID = "skatehubba";
const BATCH_SIZE = 400;

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");

function initAdmin() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    const serviceAccount = JSON.parse(readFileSync(credPath, "utf-8"));
    initializeApp({ credential: cert(serviceAccount) });
  } else {
    initializeApp();
  }
  return getFirestore(FIRESTORE_DB_ID);
}

/**
 * Count the number of clipVotes docs whose `clipId` field equals the given
 * clip id. Uses a `where` query rather than `getCountFromServer` so the
 * script keeps working under emulator setups that lack the aggregate index.
 */
async function countVotesForClip(db, clipId) {
  const snap = await db.collection("clipVotes").where("clipId", "==", clipId).get();
  return snap.size;
}

async function backfill(db) {
  console.log(`backfill: scanning clips collection (dryRun=${DRY_RUN})...`);
  const clipsSnap = await db.collection("clips").get();
  console.log(`backfill: found ${clipsSnap.size} clip docs`);

  let batch = db.batch();
  let opsInBatch = 0;
  let processed = 0;
  let committed = 0;

  for (const clipDoc of clipsSnap.docs) {
    const count = await countVotesForClip(db, clipDoc.id);

    if (DRY_RUN) {
      console.log(`PLAN ${clipDoc.id} → upvoteCount=${count}`);
      processed += 1;
      continue;
    }

    batch.update(clipDoc.ref, { upvoteCount: count });
    opsInBatch += 1;
    processed += 1;

    if (opsInBatch >= BATCH_SIZE) {
      await batch.commit();
      committed += opsInBatch;
      console.log(`PROCESSED batch committed=${committed}/${clipsSnap.size}`);
      batch = db.batch();
      opsInBatch = 0;
    }
  }

  if (!DRY_RUN && opsInBatch > 0) {
    await batch.commit();
    committed += opsInBatch;
    console.log(`PROCESSED final batch committed=${committed}/${clipsSnap.size}`);
  }

  console.log(`backfill: done processed=${processed} committed=${DRY_RUN ? 0 : committed}`);
}

(async () => {
  const db = initAdmin();
  try {
    await backfill(db);
    process.exit(0);
  } catch (err) {
    console.error("backfill: failed", err);
    process.exit(1);
  }
})();
