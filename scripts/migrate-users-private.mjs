#!/usr/bin/env node
/**
 * Users public/private split — backfill migration.
 *
 * Moves five sensitive fields off the cross-user-readable `users/{uid}`
 * public doc and into the owner-only subcollection companion
 * `users/{uid}/private/profile`:
 *
 *   email, emailVerified, dob, parentalConsent, fcmTokens
 *
 * Run this AFTER the rules + code for the public/private split have
 * shipped (see firestore.rules transitional block and
 * docs/DATABASE.md → Deploy runbook).
 *
 * Properties you can rely on:
 *
 * - Idempotent — safe to re-run over and over. Each user is processed
 *   in a Firestore transaction that reads both the public and private
 *   doc, merges any sensitive fields off the public doc into the
 *   private doc, and then strips them from the public doc with
 *   FieldValue.delete(). If the fields are already absent from the
 *   public doc, the user is a no-op.
 *
 * - Resumable — on failure partway through the fleet, rerun and it
 *   will pick up the remaining users. Each user's read-merge-strip is
 *   in its own transaction; no cross-user state is kept.
 *
 * - Progress-logged — emits one line per user with a PROCESSED / SKIPPED /
 *   FAILED tag and the uid. Suitable for `tee`-ing to a log file and
 *   grepping for FAILED afterwards.
 *
 * Usage:
 *
 *   # Requires a service-account key with Firestore read+write access.
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
 *
 *   # Dry run — prints what would change without writing.
 *   node scripts/migrate-users-private.mjs --dry-run
 *
 *   # Live run.
 *   node scripts/migrate-users-private.mjs
 *
 *   # Resume after a partial failure — the migration is idempotent, so
 *   # just rerun it. No state file needed.
 *
 * Post-run verification:
 *
 *   node scripts/migrate-users-private.mjs --verify
 *
 * Which scans every user doc and exits non-zero if any sensitive field
 * is still present at the top level. Gate the "tighten rules" follow-up
 * PR on a clean --verify run.
 */

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const FIRESTORE_DB_ID = "skatehubba";
const PRIVATE_PROFILE_DOC_ID = "profile";
const SENSITIVE_FIELDS = ["email", "emailVerified", "dob", "parentalConsent", "fcmTokens"];

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const VERIFY = args.has("--verify");

function initAdmin() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    const serviceAccount = JSON.parse(readFileSync(credPath, "utf-8"));
    initializeApp({ credential: cert(serviceAccount) });
  } else {
    // Falls back to application-default credentials (e.g. on a
    // GCP host). Fails loudly if none are available.
    initializeApp();
  }
  return getFirestore(FIRESTORE_DB_ID);
}

/**
 * Scan-only mode. Exits 0 if no public user doc carries any sensitive
 * field at the top level; exits 1 otherwise.
 */
async function verify(db) {
  console.log("verify: scanning users/* for residual sensitive fields...");
  let offending = 0;
  let total = 0;
  const snap = await db.collection("users").get();
  for (const d of snap.docs) {
    total += 1;
    const data = d.data();
    const leaks = SENSITIVE_FIELDS.filter((f) => f in data);
    if (leaks.length) {
      offending += 1;
      console.log(`LEAK ${d.id} still has: ${leaks.join(", ")}`);
    }
  }
  console.log(`verify: scanned=${total} offending=${offending}`);
  process.exit(offending === 0 ? 0 : 1);
}

/**
 * Migrate a single user. Transaction body:
 *   1. Read users/{uid} (public).
 *   2. If no sensitive field is present, exit (idempotent no-op).
 *   3. Read users/{uid}/private/profile (private, may be missing).
 *   4. Build a merged private payload (existing private + legacy
 *      sensitive fields from public). Existing private values WIN —
 *      newer data on the private doc must not be clobbered by an older
 *      value that was still sitting on the public doc.
 *   5. tx.set(private, merged, { merge: true }).
 *   6. tx.update(public, { <field>: FieldValue.delete() } for each
 *      legacy sensitive field that was present).
 */
async function migrateUser(db, uid) {
  const publicRef = db.collection("users").doc(uid);
  const privateRef = publicRef.collection("private").doc(PRIVATE_PROFILE_DOC_ID);

  const result = await db.runTransaction(async (tx) => {
    const publicSnap = await tx.get(publicRef);
    if (!publicSnap.exists) return { status: "SKIPPED", reason: "public_missing" };

    const publicData = publicSnap.data() ?? {};
    const leaked = SENSITIVE_FIELDS.filter((f) => f in publicData);
    if (leaked.length === 0) return { status: "SKIPPED", reason: "clean" };

    const privateSnap = await tx.get(privateRef);
    const privateData = privateSnap.exists ? (privateSnap.data() ?? {}) : {};

    // Build merge payload. Existing private data wins over legacy
    // inline public data — see idempotency argument above.
    const mergePayload = {};
    for (const f of leaked) {
      if (!(f in privateData)) mergePayload[f] = publicData[f];
    }

    // Build delete payload: every leaked field gets removed from the
    // public doc, regardless of whether we also added it to private.
    const deletePayload = {};
    for (const f of leaked) deletePayload[f] = FieldValue.delete();

    if (DRY_RUN) {
      return {
        status: "PROCESSED",
        reason: `DRY_RUN merge=${Object.keys(mergePayload).join(",") || "none"} delete=${leaked.join(",")}`,
      };
    }

    if (Object.keys(mergePayload).length > 0) {
      tx.set(privateRef, mergePayload, { merge: true });
    }
    tx.update(publicRef, deletePayload);

    return { status: "PROCESSED", reason: `delete=${leaked.join(",")}` };
  });

  return result;
}

async function run(db) {
  console.log(`migrate-users-private: starting (dry_run=${DRY_RUN})`);

  // Paginate to avoid loading every user into memory.
  const PAGE_SIZE = 200;
  let cursor = null;
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let total = 0;

  while (true) {
    let q = db.collection("users").orderBy("__name__").limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const page = await q.get();
    if (page.empty) break;

    for (const docSnap of page.docs) {
      total += 1;
      const uid = docSnap.id;
      try {
        const { status, reason } = await migrateUser(db, uid);
        if (status === "PROCESSED") processed += 1;
        else skipped += 1;
        console.log(`${status} ${uid} ${reason}`);
      } catch (err) {
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`FAILED ${uid} ${msg}`);
      }
    }

    cursor = page.docs[page.docs.length - 1];
    if (page.size < PAGE_SIZE) break;
  }

  console.log(
    `migrate-users-private: done total=${total} processed=${processed} skipped=${skipped} failed=${failed}`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

const db = initAdmin();

if (VERIFY) {
  verify(db).catch((err) => {
    console.error("verify failed:", err);
    process.exit(2);
  });
} else {
  run(db).catch((err) => {
    console.error("run failed:", err);
    process.exit(2);
  });
}
