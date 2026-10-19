#!/usr/bin/env node
/**
 * npm run review:seed — create or refresh the App Review demo account in
 * sk8hub-d7806 (database "skatehubba").
 *
 *   REVIEW_EMAIL=... REVIEW_PASSWORD=... npm run review:seed [-- --dry-run]
 *
 * Credentials come only from env (never committed, never printed). Uses
 * Application Default Credentials, like the other admin scripts. Safe to
 * re-run: deterministic doc ids, password and data are reset each time.
 * The account gets public features only (no featureTesters entry).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSeedDocs, reviewEnv } from "./plan.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function tutorialVersion(root = ROOT) {
  const m = /TUTORIAL_VERSION\s*=\s*(\d+)/.exec(readFileSync(resolve(root, "src/services/onboarding.ts"), "utf-8"));
  return m ? Number(m[1]) : 1;
}

export async function main(argv = process.argv.slice(2), env = process.env, admin) {
  const cfg = reviewEnv(env);
  if (cfg.missing.length) {
    console.error(`[review:seed] set ${cfg.missing.join(" and ")} in your environment first.`);
    return 1;
  }
  const dry = argv.includes("--dry-run");
  admin ??= await loadAdmin();
  let uid;
  try {
    uid = (await admin.auth.getUserByEmail(cfg.email)).uid;
    if (!dry) await admin.auth.updateUser(uid, { password: cfg.password, emailVerified: true, disabled: false });
    console.log("[review:seed] reviewer account exists — password reset to REVIEW_PASSWORD");
  } catch (err) {
    if (err?.code !== "auth/user-not-found") throw err;
    uid = dry
      ? "(new uid)"
      : (await admin.auth.createUser({ email: cfg.email, password: cfg.password, emailVerified: true })).uid;
    console.log("[review:seed] created reviewer account");
  }
  const docs = buildSeedDocs({ uid, username: cfg.username, appUrl: cfg.appUrl, tutorialVersion: tutorialVersion() });
  if (dry) {
    for (const [p] of docs) console.log(`  would write ${p}`);
    return 0;
  }
  const batch = admin.db.batch();
  for (const [p, data] of docs) batch.set(admin.db.doc(p), data);
  await batch.commit();
  console.log(
    `[review:seed] wrote ${docs.length} docs for @${cfg.username}. Put the email/password in App Store Connect → App Review Information.`,
  );
  return 0;
}

async function loadAdmin() {
  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = initializeApp({ credential: applicationDefault(), projectId: "sk8hub-d7806" }, "review-seed");
  return { auth: getAuth(app), db: getFirestore(app, "skatehubba") };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (c) => process.exit(c),
    (e) => {
      console.error(`[review:seed] ${e?.message ?? e}`);
      process.exit(1);
    },
  );
}
