#!/usr/bin/env node
/**
 * Admin custom claim — grant / revoke.
 *
 * The admin console (src/services/admin.ts) and every `firestore.rules` clause
 * behind it key off a single Firebase Auth custom claim: `admin: true`. Custom
 * claims can only be set with the Admin SDK, which is what this script is for.
 *
 * Usage:
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
 *
 *   # Grant
 *   node scripts/set-admin-claim.mjs <uid>
 *
 *   # Revoke
 *   node scripts/set-admin-claim.mjs <uid> --revoke
 *
 * Properties:
 *
 * - Idempotent — re-granting an existing admin, or revoking a non-admin, is a
 *   no-op in effect; the resulting claim set is printed either way.
 *
 * - Preserves other claims — the script merges into the user's existing custom
 *   claims rather than replacing them, so an unrelated claim added later is not
 *   silently wiped by an admin grant. `setCustomUserClaims` overwrites the whole
 *   object, so the merge has to happen here.
 *
 * - Non-destructive on revoke — `admin` is DELETED from the claim set rather
 *   than set to `false`. A rules check of `request.auth.token.admin == true` is
 *   satisfied by neither, but an absent key keeps the token payload clean.
 *
 * PROPAGATION: a claim change does NOT affect an already-issued ID token. The
 * user must sign out and back in (or wait for the ~1h token refresh) before
 * rules see it. The script prints this reminder on every run.
 */

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const USAGE = "Usage: node scripts/set-admin-claim.mjs <uid> [--revoke]";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));
const REVOKE = flags.has("--revoke");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs() {
  const unknown = [...flags].filter((f) => f !== "--revoke");
  if (unknown.length > 0) fail(`Unknown flag(s): ${unknown.join(", ")}\n${USAGE}`);
  if (positional.length !== 1) fail(USAGE);

  const uid = positional[0].trim();
  // The uid goes straight to the Auth Admin API, but a blank or path-shaped
  // value is always a copy/paste accident — refuse rather than round-trip it.
  if (!uid || uid.includes("/")) fail(`Invalid uid: "${positional[0]}"\n${USAGE}`);
  return uid;
}

function initAdmin() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    fail(
      "Missing credentials. Set GOOGLE_APPLICATION_CREDENTIALS to a service-account\n" +
        "key with the Firebase Authentication Admin role, e.g.\n" +
        "  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json",
    );
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(readFileSync(credPath, "utf-8"));
  } catch (err) {
    fail(`Could not read service-account key at ${credPath}: ${err.message}`);
  }

  initializeApp({ credential: cert(serviceAccount) });
  return getAuth();
}

async function setAdminClaim(auth, uid) {
  let user;
  try {
    user = await auth.getUser(uid);
  } catch (err) {
    fail(`No Auth user with uid "${uid}" (${err.code || err.message}).`);
  }

  // setCustomUserClaims replaces the entire claim object, so merge rather than
  // clobber any unrelated claim this account already carries.
  const current = user.customClaims || {};
  const next = { ...current };
  if (REVOKE) {
    delete next.admin;
  } else {
    next.admin = true;
  }

  await auth.setCustomUserClaims(uid, next);

  // Read back rather than echoing what we sent — the printed claims are then
  // the server's state, not this script's intent.
  const updated = await auth.getUser(uid);
  const claims = updated.customClaims || {};

  console.log(`${REVOKE ? "REVOKED" : "GRANTED"} admin for ${uid} (${updated.email || "no email"})`);
  console.log(`claims: ${JSON.stringify(claims)}`);
  console.log(
    "\nNOTE: existing ID tokens still carry the OLD claims. The user must sign out\n" +
      "and back in (or wait for the ~1h token refresh) before Firestore rules and\n" +
      "the admin console see this change.",
  );
}

(async () => {
  const uid = parseArgs();
  const auth = initAdmin();
  try {
    await setAdminClaim(auth, uid);
    process.exit(0);
  } catch (err) {
    console.error("set-admin-claim: failed", err);
    process.exit(1);
  }
})();
