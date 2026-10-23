#!/usr/bin/env npx tsx
/**
 * Seed verified-pro status from a trusted operator machine (Admin SDK).
 *
 * Usage:
 *   npx tsx scripts/grant-pro.ts <username> --admin-uid <yourUid> \
 *     --reason "Pro for Baker since 2019, two video parts" \
 *     --company "Baker Skateboards" --url "https://bakerskateboards.com/team/x"
 *
 * Same contract as the `proSeed` callable (security audit 2026-10-21, H5),
 * running the same code with `source: "cli"`:
 *  - input is validated by `parseSeedInput` (reason 10-280 chars, evidence
 *    company + a real https link);
 *  - `seedPro` refuses self-seeds, admin targets (pros are never admins),
 *    missing, already-pro and banned targets, and writes the badge plus an
 *    append-only `proAudit` row in ONE transaction;
 *  - `--admin-uid` must hold the `admin` custom claim, so the audit row names
 *    a real admin as the actor.
 *
 * It uses the Admin SDK directly, so it works without the deployed function.
 * Requires GOOGLE_APPLICATION_CREDENTIALS (or default application credentials).
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, type Firestore } from "firebase-admin/firestore";
import { parseSeedInput, SeedInputError } from "../functions/src/pro/seedInput.js";
import { adminClaimLookup, SeedError, seedPro } from "../functions/src/pro/seedCore.js";
import { adminDiceDb } from "../functions/src/dice/store.js";
// The functions package types against its own firebase-admin copy; the adapter
// only calls standard Firestore methods, so the root instance satisfies it.
type FunctionsFirestore = Parameters<typeof adminDiceDb>[0];

const FIRESTORE_DB_ID = "skatehubba";
const USAGE =
  'Usage: npx tsx scripts/grant-pro.ts <username> --admin-uid <uid> --reason "..." --company "..." --url "https://..."';

const MESSAGES: Record<string, string> = {
  self_seed: "You cannot seed yourself.",
  target_is_admin: "That account holds the admin claim. Pros are never admins.",
  not_found: "User profile not found.",
  already_pro: "Already a verified pro. No changes made.",
  target_banned: "That account is banned. No changes made.",
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "admin-uid": { type: "string" },
      reason: { type: "string" },
      company: { type: "string" },
      url: { type: "string" },
    },
  });
  const username = positionals[0]?.toLowerCase().trim();
  const adminUid = values["admin-uid"]?.trim();
  if (!username || !adminUid || adminUid.includes("/")) fail(USAGE);

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    const serviceAccount = JSON.parse(readFileSync(credPath, "utf-8")) as ServiceAccount;
    initializeApp({ credential: cert(serviceAccount) });
  } else {
    initializeApp();
  }
  const db: Firestore = getFirestore(FIRESTORE_DB_ID);
  const isAdmin = adminClaimLookup(getAuth());

  if (!(await isAdmin(adminUid))) fail(`--admin-uid ${adminUid} does not hold the admin claim.`);

  const usernameSnap = await db.collection("usernames").doc(username).get();
  if (!usernameSnap.exists) fail(`Username "@${username}" not found in Firestore.`);
  const uid = usernameSnap.data()?.uid;
  if (typeof uid !== "string") fail(`Username "@${username}" has no uid.`);

  let input;
  try {
    input = parseSeedInput({
      targetUid: uid,
      reason: values.reason,
      evidence: { company: values.company, url: values.url },
    });
  } catch (err) {
    if (err instanceof SeedInputError) fail(`Invalid input: ${err.code}\n${USAGE}`);
    throw err;
  }

  try {
    const result = await seedPro(
      { db: adminDiceDb(db as unknown as FunctionsFirestore), isAdmin, stamp: FieldValue.serverTimestamp() },
      adminUid,
      input,
      "cli",
    );
    console.log(`✓ @${username} is now a verified pro (audit ${result.auditId}).`);
  } catch (err) {
    if (err instanceof SeedError) fail(`@${username}: ${MESSAGES[err.code] ?? err.code}`);
    throw err;
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
