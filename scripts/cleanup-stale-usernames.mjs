#!/usr/bin/env node
/**
 * Cleanup stale username reservations.
 *
 * Problem: When a user account is deleted, the username reservation in
 * `usernames/{username}` is not automatically cleaned up. This script
 * identifies and removes reservations for deleted accounts.
 *
 * Safety:
 * - DRY RUN by default (pass --execute to apply changes)
 * - Only removes usernames where the referenced user doc no longer exists
 * - Logs all operations for audit trail
 * - Rate limited to avoid Firestore quota issues
 *
 * Usage:
 *   # Dry run (safe, shows what would be deleted):
 *   node scripts/cleanup-stale-usernames.mjs
 *
 *   # Execute cleanup:
 *   node scripts/cleanup-stale-usernames.mjs --execute
 *
 * Requires:
 *   - GOOGLE_APPLICATION_CREDENTIALS env var pointing to service account JSON
 *   - OR gcloud default credentials configured
 *   - Firebase Admin SDK access to the production project
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { readFile } from "fs/promises";

const DRY_RUN = !process.argv.includes("--execute");
const BATCH_SIZE = 100;
const DELAY_MS = 1000; // 1 second between batches

// Initialize Firebase Admin
let app;
try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const serviceAccount = JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"));
    app = initializeApp({ credential: cert(serviceAccount) });
  } else {
    app = initializeApp();
  }
} catch (error) {
  console.error("Failed to initialize Firebase Admin:", error.message);
  console.error("\nEnsure GOOGLE_APPLICATION_CREDENTIALS is set or gcloud is configured.");
  process.exit(1);
}

// The app uses the named "skatehubba" database, not (default).
const db = getFirestore(app, "skatehubba");
const auth = getAuth(app);

/**
 * Sleep for the given milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A reservation is only stale when BOTH the profile doc and the Auth account
 * are gone. A missing profile alone can be a signup that is mid-way through
 * profile setup, so it is never enough to free the name.
 */
async function userExists(uid) {
  const doc = await db.collection("users").doc(uid).get();
  if (doc.exists) return true;
  try {
    await auth.getUser(uid);
    return true;
  } catch (error) {
    if (error?.code === "auth/user-not-found") return false;
    throw error;
  }
}

/**
 * Find all username reservations and check if their users still exist.
 */
async function findStaleUsernames() {
  console.log("Scanning username reservations...\n");

  const usernamesSnapshot = await db.collection("usernames").get();
  const stale = [];
  const active = [];

  let checked = 0;
  for (const doc of usernamesSnapshot.docs) {
    const data = doc.data();
    const uid = data?.uid;

    if (!uid) {
      console.warn(`⚠️  ${doc.id}: Missing uid field`);
      continue;
    }

    const exists = await userExists(uid);
    checked++;

    if (exists) {
      active.push({ username: doc.id, uid });
    } else {
      stale.push({ username: doc.id, uid });
      console.log(`❌ ${doc.id} → ${uid} (user deleted)`);
    }

    // Rate limit to avoid quota issues
    if (checked % 10 === 0) {
      await sleep(100);
    }
  }

  console.log(`\n✓ Scanned ${checked} username reservations`);
  console.log(`  Active: ${active.length}`);
  console.log(`  Stale:  ${stale.length}`);

  return stale;
}

/**
 * Delete stale username reservations in batches.
 */
async function deleteStaleUsernames(staleUsernames) {
  if (staleUsernames.length === 0) {
    console.log("\n✓ No stale usernames to clean up.");
    return;
  }

  console.log(`\n${DRY_RUN ? "[DRY RUN]" : "[EXECUTE]"} Deleting ${staleUsernames.length} stale username(s)...\n`);

  let deleted = 0;
  for (let i = 0; i < staleUsernames.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = staleUsernames.slice(i, i + BATCH_SIZE);

    for (const { username } of chunk) {
      const ref = db.collection("usernames").doc(username);
      batch.delete(ref);
      console.log(`  🗑️  ${username}`);
    }

    if (!DRY_RUN) {
      await batch.commit();
      deleted += chunk.length;
      console.log(`    ↳ Batch committed (${deleted}/${staleUsernames.length})`);
    }

    // Rate limit between batches
    if (i + BATCH_SIZE < staleUsernames.length) {
      await sleep(DELAY_MS);
    }
  }

  if (DRY_RUN) {
    console.log(`\n[DRY RUN] Would delete ${staleUsernames.length} username(s).`);
    console.log("Run with --execute to apply changes.");
  } else {
    console.log(`\n✓ Deleted ${deleted} stale username reservation(s).`);
  }
}

async function main() {
  console.log("Username Cleanup Script");
  console.log("=======================\n");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "EXECUTE"}\n`);

  try {
    const staleUsernames = await findStaleUsernames();
    await deleteStaleUsernames(staleUsernames);
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  }

  process.exit(0);
}

main();
