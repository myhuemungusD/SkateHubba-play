#!/usr/bin/env node
/**
 * Admin-only export of trick-training labels as JSONL on stdout.
 *
 * Uses the Firebase Admin SDK, which bypasses security rules. Run it only
 * with a service account that is allowed to read `trainingLabels`. Do not
 * commit the output. Labels marked excluded, or whose consent snapshot is
 * not opted in, are skipped.
 *
 * Usage:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
 *   node scripts/export-training-labels.mjs > labels.jsonl
 *
 * Or pass the key JSON itself (still a secret — do not print it):
 *   FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' \
 *     node scripts/export-training-labels.mjs > labels.jsonl
 */

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const FIRESTORE_DB_ID = "skatehubba";
const PAGE = 500;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function initAdmin() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (inline) {
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(inline);
    } catch (err) {
      fail(`FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ${err.message}`);
    }
    initializeApp({ credential: cert(serviceAccount) });
    return;
  }
  if (!credPath) {
    fail(
      "Missing credentials. Set GOOGLE_APPLICATION_CREDENTIALS to a service-account\n" +
        "key, or FIREBASE_SERVICE_ACCOUNT_JSON to the key's JSON.",
    );
  }
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(readFileSync(credPath, "utf-8"));
  } catch (err) {
    fail(`Could not read service-account key at ${credPath}: ${err.message}`);
  }
  initializeApp({ credential: cert(serviceAccount) });
}

function jsonSafe(value) {
  if (value == null) return value;
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date ? date.toISOString() : null;
  }
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = jsonSafe(child);
    return out;
  }
  return value;
}

function keep(data) {
  if (data.excluded === true) return false;
  const consent = data.consent;
  return Boolean(consent && typeof consent === "object" && consent.optedIn === true);
}

async function main() {
  initAdmin();
  const db = getFirestore(FIRESTORE_DB_ID);
  let last = null;
  let written = 0;
  let skipped = 0;
  for (;;) {
    let query = db.collection("trainingLabels").orderBy("__name__").limit(PAGE);
    if (last) query = query.startAfter(last);
    const snap = await query.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const data = doc.data();
      if (!keep(data)) {
        skipped += 1;
        continue;
      }
      const line = jsonSafe({ id: doc.id, ...data });
      process.stdout.write(`${JSON.stringify(line)}\n`);
      written += 1;
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }
  console.error(`exported ${written} label(s), skipped ${skipped}`);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
