#!/usr/bin/env node
/**
 * Mark (or unmark) internal QA / test accounts so they stay out of the public
 * player lists: the lobby directory, the S.K.A.T.E. and Roll Dice opponent
 * pickers, and the leaderboard (see isPubliclyListed in src/services/users.ts).
 *
 * The flag is `users/{uid}.isTestAccount = true`. firestore.rules denies it on
 * every client create and update, the owner included, so only the Admin SDK
 * (this script) can set or clear it. The profile page itself still opens by
 * direct link; the account is just not listed.
 *
 * Usage:
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
 *
 *   # Dry run (default): resolve the accounts and print what would change
 *   node scripts/set-test-account.mjs qa_tester_1 qa_tester_2
 *
 *   # Write the flag
 *   node scripts/set-test-account.mjs qa_tester_1 qa_tester_2 --apply
 *
 *   # Remove the flag again
 *   node scripts/set-test-account.mjs qa_tester_1 --unset --apply
 *
 * Accounts are named by username (looked up in usernames/{name}) or by uid with
 * a `uid:` prefix, e.g. `uid:8emCoonXvOV0U8bWjvs58TJjAXr1`.
 *
 * Safety:
 * - Dry run unless --apply is passed.
 * - Writes ONLY the isTestAccount field (update, never set), so no other
 *   profile field can be touched and a missing profile is reported, not created.
 * - Unset deletes the field rather than writing false: absent is the normal
 *   state for every real player.
 * - Honors FIRESTORE_EMULATOR_HOST, so it can be tried against the emulator.
 */

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const USAGE = "Usage: node scripts/set-test-account.mjs <username|uid:UID>... [--unset] [--apply]";
const KNOWN_FLAGS = new Set(["--unset", "--apply"]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

export function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const unknown = [...flags].filter((f) => !KNOWN_FLAGS.has(f));
  if (unknown.length > 0) throw new Error(`Unknown flag(s): ${unknown.join(", ")}\n${USAGE}`);
  const names = argv.filter((a) => !a.startsWith("--")).map((a) => a.trim());
  if (names.length === 0) throw new Error(USAGE);
  const targets = names.map((name) => {
    if (name.startsWith("uid:")) {
      const uid = name.slice(4);
      if (!uid || uid.includes("/")) throw new Error(`Invalid uid: "${name}"`);
      return { kind: "uid", value: uid };
    }
    const username = name.toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new Error(`Invalid username: "${name}"`);
    return { kind: "username", value: username };
  });
  return { targets, unset: flags.has("--unset"), apply: flags.has("--apply") };
}

function initDb() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-skatehubba" });
  } else if (credPath) {
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(readFileSync(credPath, "utf-8"));
    } catch (err) {
      fail(`Could not read service-account key at ${credPath}: ${err.message}`);
    }
    initializeApp({ credential: cert(serviceAccount) });
  } else {
    fail("Missing credentials. Set GOOGLE_APPLICATION_CREDENTIALS (or FIRESTORE_EMULATOR_HOST for the emulator).");
  }
  // The app uses the named "skatehubba" database, not (default).
  return getFirestore("skatehubba");
}

async function resolveUid(db, target) {
  if (target.kind === "uid") return target.value;
  const snap = await db.collection("usernames").doc(target.value).get();
  const uid = snap.exists ? snap.get("uid") : null;
  return typeof uid === "string" ? uid : null;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    fail(err.message);
  }
  const db = initDb();
  const mode = opts.apply ? "APPLY" : "DRY RUN";
  console.log(`${mode}: ${opts.unset ? "remove" : "set"} isTestAccount on ${opts.targets.length} account(s)`);

  let failures = 0;
  for (const target of opts.targets) {
    const label = target.kind === "uid" ? `uid:${target.value}` : `@${target.value}`;
    const uid = await resolveUid(db, target);
    if (!uid) {
      console.log(`  SKIP ${label}: no such username`);
      failures++;
      continue;
    }
    const ref = db.collection("users").doc(uid);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`  SKIP ${label} (${uid}): no users/${uid} profile`);
      failures++;
      continue;
    }
    const before = snap.get("isTestAccount") === true;
    const after = !opts.unset;
    if (before === after) {
      console.log(`  OK   ${label} (${uid}): already ${after ? "flagged" : "unflagged"}`);
      continue;
    }
    if (opts.apply) {
      await ref.update({ isTestAccount: opts.unset ? FieldValue.delete() : true });
    }
    console.log(`  ${opts.apply ? "DONE" : "WOULD"} ${label} (${uid}): ${before} -> ${after}`);
  }
  if (!opts.apply) console.log("\nNothing was written. Re-run with --apply to make these changes.");
  process.exit(failures > 0 ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("set-test-account: failed", err);
    process.exit(1);
  });
}
