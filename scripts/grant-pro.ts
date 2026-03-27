#!/usr/bin/env npx tsx
/**
 * Grant verified-pro status to a user.
 *
 * Usage:
 *   npx tsx scripts/grant-pro.ts <username>
 *   npx tsx scripts/grant-pro.ts mikewhite
 *
 * Requires:
 *   - GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service account key
 *     (or running on a machine with default application credentials)
 *   - The firebase-admin package: npm install -D firebase-admin
 *
 * What it does:
 *   1. Looks up `usernames/<username>` to get the UID
 *   2. Updates `users/<uid>` with { isVerifiedPro: true, verifiedBy: "admin", verifiedAt: ... }
 *
 * Admin SDK bypasses Firestore security rules, so no rule changes are needed.
 */

import { readFileSync } from "node:fs";
import { initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const FIRESTORE_DB_ID = "skatehubba";

async function main() {
  const username = process.argv[2]?.toLowerCase().trim();
  if (!username) {
    console.error("Usage: npx tsx scripts/grant-pro.ts <username>");
    process.exit(1);
  }

  // Initialize Admin SDK
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    const serviceAccount = JSON.parse(readFileSync(credPath, "utf-8")) as ServiceAccount;
    initializeApp({ credential: cert(serviceAccount) });
  } else {
    initializeApp();
  }

  const db = getFirestore(FIRESTORE_DB_ID);

  // Step 1: Look up username → uid
  const usernameSnap = await db.collection("usernames").doc(username).get();
  if (!usernameSnap.exists) {
    console.error(`Username "@${username}" not found in Firestore.`);
    process.exit(1);
  }
  const uid = usernameSnap.data()?.uid as string;
  console.log(`Found @${username} → uid: ${uid}`);

  // Step 2: Verify user profile exists
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    console.error(`User profile for uid "${uid}" not found.`);
    process.exit(1);
  }

  const current = userSnap.data();
  if (current?.isVerifiedPro) {
    console.log(`@${username} is already a verified pro. No changes made.`);
    process.exit(0);
  }

  // Step 3: Grant pro status
  await db.collection("users").doc(uid).update({
    isVerifiedPro: true,
    verifiedBy: "admin",
    verifiedAt: FieldValue.serverTimestamp(),
  });

  console.log(`✓ @${username} is now a verified pro!`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
