#!/usr/bin/env node
/**
 * npm run review:seed — create or refresh the App Review demo account in
 * sk8hub-d7806 (database "skatehubba").
 *
 *   REVIEW_EMAIL=... REVIEW_PASSWORD=... npm run review:seed [-- --dry-run]
 *   ... npm run review:seed -- --emulator   (local emulators, project demo-skatehubba)
 *
 * Set REVIEW_STORAGE_BUCKET for production so the demo clip is uploaded to
 * Storage (the game screen only plays Storage URLs).
 * Credentials come only from env (never committed, never printed). Uses
 * Application Default Credentials, like the other admin scripts. Safe to
 * re-run: deterministic doc ids, password and data are reset each time.
 * The account gets public features only (no featureTesters entry).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DEMO_VIDEO_PATH, buildSeedDocs, reviewEnv, storageDownloadUrl } from "./plan.mjs";

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
  const emulator = emulatorTarget(argv, env);
  admin ??= await loadAdmin(emulator);
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
  const videoUrl = dry ? undefined : await uploadDemoVideo(admin);
  const docs = buildSeedDocs({
    uid,
    videoUrl,
    username: cfg.username,
    appUrl: cfg.appUrl,
    tutorialVersion: tutorialVersion(),
    tipsDisabled: emulator !== null,
  });
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

/**
 * Uploads the demo clip to Storage and returns its download URL, or undefined
 * (falls back to the hosted copy) when no bucket is configured.
 */
export async function uploadDemoVideo(admin, root = ROOT) {
  if (!admin.bucket) {
    console.warn('[review:seed] no REVIEW_STORAGE_BUCKET; game screens will show "No video recorded"');
    return undefined;
  }
  const token = randomUUID();
  await admin.bucket.file(DEMO_VIDEO_PATH).save(readFileSync(resolve(root, "public/sh-video-edit.mp4")), {
    contentType: "video/mp4",
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });
  return storageDownloadUrl(admin.bucket.name, DEMO_VIDEO_PATH, token);
}

/**
 * `--emulator` seeds the local Auth + Firestore emulators instead of
 * production, for store screenshots that never touch real data. Returns the
 * emulator hosts to set, or null for production.
 */
export function emulatorTarget(argv, env) {
  if (!argv.includes("--emulator")) return null;
  return {
    projectId: "demo-skatehubba",
    firestore: env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080",
    auth: env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099",
    storage: env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199",
    bucket: "demo-skatehubba.appspot.com",
  };
}

async function loadAdmin(emulator, env = process.env) {
  if (emulator) {
    process.env.FIRESTORE_EMULATOR_HOST = emulator.firestore;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = emulator.auth;
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = emulator.storage;
  }
  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = emulator
    ? initializeApp({ projectId: emulator.projectId }, "review-seed")
    : initializeApp({ credential: applicationDefault(), projectId: "sk8hub-d7806" }, "review-seed");
  const { getStorage } = await import("firebase-admin/storage");
  const bucketName = emulator ? emulator.bucket : env.REVIEW_STORAGE_BUCKET;
  return {
    auth: getAuth(app),
    db: getFirestore(app, "skatehubba"),
    bucket: bucketName ? getStorage(app).bucket(bucketName) : null,
  };
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
