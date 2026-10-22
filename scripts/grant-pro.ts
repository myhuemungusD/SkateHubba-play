#!/usr/bin/env npx tsx
/**
 * Seed verified-pro status from a trusted operator machine (Admin SDK).
 *
 * Usage:
 *   npx tsx scripts/grant-pro.ts <username> --admin-uid <yourUid> \
 *     --reason "Pro for Baker since 2019, two video parts" \
 *     --company "Baker Skateboards" --url "https://bakerskateboards.com/team/x"
 *
 * The in-app path is the `proSeed` callable (Admin → Seed Pro). This CLI is
 * for the founder bootstrap only and follows the same contract (security
 * audit 2026-10-21): reason + evidence are required (validated by the same
 * `parseSeedInput` the callable uses), `verifiedBy` is the operator's uid,
 * and the badge and an append-only `proAudit` row are written in ONE
 * transaction with `source: "cli"`.
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS (or default application credentials).
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { parseSeedInput, SeedInputError } from "../functions/src/pro/seedInput.js";

const FIRESTORE_DB_ID = "skatehubba";
const USAGE =
  'Usage: npx tsx scripts/grant-pro.ts <username> --admin-uid <uid> --reason "..." --company "..." --url "https://..."';

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
  if (!username || !adminUid || adminUid.includes("/")) {
    console.error(USAGE);
    process.exit(1);
  }

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    const serviceAccount = JSON.parse(readFileSync(credPath, "utf-8")) as ServiceAccount;
    initializeApp({ credential: cert(serviceAccount) });
  } else {
    initializeApp();
  }
  const db = getFirestore(FIRESTORE_DB_ID);

  const usernameSnap = await db.collection("usernames").doc(username).get();
  if (!usernameSnap.exists) {
    console.error(`Username "@${username}" not found in Firestore.`);
    process.exit(1);
  }
  const uid = usernameSnap.data()?.uid as string;

  let input;
  try {
    input = parseSeedInput({
      targetUid: uid,
      reason: values.reason,
      evidence: { company: values.company, url: values.url },
    });
  } catch (err) {
    console.error(err instanceof SeedInputError ? `Invalid input: ${err.code}` : err);
    console.error(USAGE);
    process.exit(1);
  }

  const userRef = db.collection("users").doc(uid);
  const auditRef = db.collection("proAudit").doc();
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) return "missing";
    const current = snap.data() ?? {};
    if (current.isVerifiedPro === true) return "already";
    if (current.banned === true) return "banned";
    tx.update(userRef, { isVerifiedPro: true, verifiedBy: adminUid, verifiedAt: FieldValue.serverTimestamp() });
    tx.set(auditRef, {
      action: "seed",
      actorUid: adminUid,
      targetUid: uid,
      targetUsername: typeof current.username === "string" ? current.username : "",
      reason: input.reason,
      evidenceCompany: input.evidenceCompany,
      evidenceUrl: input.evidenceUrl,
      source: "cli",
      createdAt: FieldValue.serverTimestamp(),
    });
    return "seeded";
  });

  if (outcome === "missing") {
    console.error(`User profile for @${username} not found.`);
    process.exit(1);
  }
  if (outcome === "banned") {
    console.error(`@${username} is banned. No changes made.`);
    process.exit(1);
  }
  if (outcome === "already") {
    console.log(`@${username} is already a verified pro. No changes made.`);
    return;
  }
  console.log(`✓ @${username} is now a verified pro (audit ${auditRef.id}).`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
