/**
 * Call-time half of the api/ cold-start guard (see check-api-module-load.mjs).
 *
 * Loading a function's entry is not enough. firebase-admin loads most of its
 * SDKs on first use, not at import: getStorage() requires @google-cloud/storage
 * (→ gaxios → uuid), the first Firestore RPC requires google-gax and
 * @grpc/grpc-js, and api/_sentry.ts imports @sentry/node only once a DSN is set.
 * 1.2.0's account deletion crashed twice that way: first at boot (jwks-rsa →
 * ESM-only jose 6), then, once that was fixed, on its first Storage call
 * (gaxios 6 → `require("uuid")`, and the root override had forced ESM-only
 * uuid 14), answering 500 erasure_failed.
 *
 * Each probe here drives the real SDK calls (and, where it can, the real api/
 * code) far enough that every lazy require runs, in a child Node with
 * require(esm) disabled like Vercel's loader. It needs no credentials and makes
 * no network calls:
 *   • the service account is generated in-process (a throwaway RSA key for a
 *     made-up "demo-" project), so nothing real is ever loaded;
 *   • every outbound socket is refused before it connects (EGUARDOFFLINE), so
 *     each call fails at its first network step: after its modules loaded.
 * A probe fails if any error, log line or crash mentions a module-load failure,
 * or if the modules its call path must load never got loaded.
 *
 * Child usage: node --no-experimental-require-module scripts/api-call-time-probes.mjs <probe> <transpiled api dir>
 */

import net from "node:net";
import { generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Text that means a dependency failed to load (the error class this guard exists for). */
export const MODULE_LOAD_ERROR =
  /ERR_REQUIRE_ESM|ERR_REQUIRE_ASYNC_MODULE|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED|ERR_UNSUPPORTED_DIR_IMPORT|Cannot find (?:module|package)|missing-dependencies|Failed to import/;

const PROJECT = "demo-api-load-guard";
const BUCKET = `${PROJECT}.firebasestorage.app`;
/** Synthetic ids only: this file is in a public repo. */
const PROBE_UID = "api-load-guard-probe-uid";
/** Shape-valid, points nowhere (the network is off anyway). Not a real project. */
const DUMMY_DSN = "https://0000000000000000@o0.ingest.us.sentry.io/0";
/** How long a probe waits for a call that keeps retrying a refused socket. */
const SETTLE_MS = 4000;

/**
 * What each probe exercises. `covers` lists the package entry points it loads,
 * so the guard test can check that every SDK the functions import is probed.
 * `mustLoad` are packages, or package subpaths (each matched as
 * /node_modules/<entry>/ in require.cache), the call path has to have required
 * by the end; their absence means the lazy load never ran. A probe with nothing
 * to check can't catch a regression (if an SDK ever short-circuits, it passes
 * vacuously), so every probe has a non-empty `mustLoad` or, when require.cache
 * can't see what it loads, a `noMustLoad` saying why and what asserts it instead.
 *
 * `fetch-blob` is the request-time witness for the Auth and Messaging calls:
 * google-auth-library 11's gaxios 7 import()s node-fetch 3 (ESM, so not in
 * require.cache) on its first request, and node-fetch's fetch-blob dependency
 * require()s fetch-blob/streams.cjs. It is absent until a call actually sends
 * (initializeApp, getAuth and getMessaging alone don't load it). If gaxios ever
 * drops node-fetch this fails loudly: pick the new transport's witness.
 */
export const PROBES = {
  "firebase-admin/app": {
    covers: ["firebase-admin/app"],
    // cert()'s credential stack. initializeApp(cert) requires nothing beyond the import
    // (checked: identical require.cache), so this asserts the import graph, not a call.
    mustLoad: ["google-auth-library"],
    describe: "initializeApp(cert(serviceAccount)) as every function's getAdminApp does",
  },
  "firebase-admin/firestore": {
    covers: ["firebase-admin/firestore"],
    mustLoad: ["@google-cloud/firestore", "google-gax", "@grpc/grpc-js"],
    describe: "getFirestore(app, 'skatehubba') + query.get, collectionGroup, batch.commit, runTransaction",
  },
  "firebase-admin/storage": {
    covers: ["firebase-admin/storage"],
    mustLoad: ["@google-cloud/storage", "gaxios", "uuid"],
    describe: "getStorage(app).bucket(name).getFiles + file.delete",
  },
  "firebase-admin/auth": {
    covers: ["firebase-admin/auth"],
    // jsonwebtoken → jwks-rsa → jose is the first 1.2.0 crash chain (jose 6 is ESM-only;
    // package.json overrides jwks-rsa's jose to 5.x). fetch-blob: see above.
    mustLoad: ["jsonwebtoken", "jwks-rsa", "jose", "fetch-blob"],
    describe: "getAuth(app).verifyIdToken(checkRevoked) + revokeRefreshTokens + deleteUser",
  },
  "firebase-admin/messaging": {
    covers: ["firebase-admin/messaging"],
    // google-auth-library and gaxios mint the FCM access token, but firebase-admin/app
    // already loads both, so on their own they'd pass even if no send ran: the
    // messaging module itself and fetch-blob (the send's request; see above) discriminate.
    mustLoad: ["google-auth-library", "gaxios", "firebase-admin/lib/messaging", "fetch-blob"],
    describe: "getMessaging(app).sendEachForMulticast",
  },
  "@sentry/node": {
    covers: ["@sentry/node"],
    mustLoad: [],
    noMustLoad:
      "api/_sentry.ts import()s @sentry/node, which resolves to its ESM build (exports.import → build/esm), so it never enters require.cache; the runner fails instead when ensureSentry() returns null with a DSN set, which is exactly what a failed import() produces",
    describe: "api/_sentry.ts ensureSentry() with a DSN (dynamic import) + captureServerError + flush",
  },
  "api/account/delete": {
    covers: [],
    mustLoad: ["@google-cloud/firestore", "google-gax", "@google-cloud/storage", "gaxios", "uuid"],
    describe:
      "the real handler (withSentry, getAdminApp, verifyIdToken) + the real erasure helpers (deletePrefix, deleteUserDataAsAdmin) on cascadeDeps-shaped deps",
  },
};

/** Probes that would pass with nothing checked: empty mustLoad and no noMustLoad reason. */
export function listVacuousProbes(probes = PROBES) {
  return Object.entries(probes)
    .filter(([, p]) => p.mustLoad.length === 0 && !p.noMustLoad?.trim())
    .map(([name]) => name);
}

// ── child side ──────────────────────────────────────────────────────────────

const seen = [];
function record(value, depth = 0) {
  if (value == null || depth > 6) return;
  if (typeof value === "string") {
    seen.push(value);
    return;
  }
  if (typeof value !== "object") return;
  for (const k of ["code", "message", "stack"]) if (typeof value[k] === "string") seen.push(value[k]);
  if (value.cause) record(value.cause, depth + 1);
  if (Array.isArray(value.errors)) for (const e of value.errors) record(e, depth + 1);
  if (Array.isArray(value.responses)) for (const r of value.responses) record(r?.error, depth + 1);
}

/** Refuse every outbound socket before it connects: no network, fast failure. */
function disableNetwork() {
  net.Socket.prototype.connect = function guardOfflineConnect() {
    process.nextTick(() => {
      const err = new Error("network disabled by the api load guard");
      err.code = "EGUARDOFFLINE";
      this.destroy(err);
    });
    return this;
  };
}

function captureConsole() {
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    // Swallowed (stdout carries the result line); kept for the module-error scan.
    console[level] = (...args) => {
      for (const a of args) record(a instanceof Error ? a : typeof a === "string" ? a : safeJson(a));
    };
  }
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Run a call that should fail at the network; record whatever it settles to. */
async function attempt(fn) {
  let p;
  try {
    p = Promise.resolve(fn());
  } catch (err) {
    record(err);
    return;
  }
  const settled = await Promise.race([
    p.then(
      (v) => (record(v), true),
      (e) => (record(e), true),
    ),
    new Promise((r) => setTimeout(() => r(false), SETTLE_MS).unref()),
  ]);
  return settled;
}

function demoServiceAccount() {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return { projectId: PROJECT, clientEmail: `guard@${PROJECT}.iam.gserviceaccount.com`, privateKey };
}

/** An unsigned, well-formed token: verifyIdToken must go fetch keys for it. */
function fakeIdToken() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return [
    b64({ alg: "RS256", kid: "guard", typ: "JWT" }),
    b64({
      iss: `https://securetoken.google.com/${PROJECT}`,
      aud: PROJECT,
      sub: PROBE_UID,
      iat: now,
      exp: now + 600,
      auth_time: now,
    }),
    "c2ln",
  ].join(".");
}

async function adminApp() {
  const { initializeApp, cert } = await import("firebase-admin/app");
  return initializeApp({ credential: cert(demoServiceAccount()), storageBucket: BUCKET });
}

const RUNNERS = {
  async "firebase-admin/app"() {
    await adminApp();
  },
  async "firebase-admin/firestore"() {
    const app = await adminApp();
    const { getFirestore, FieldPath, FieldValue, Timestamp } = await import("firebase-admin/firestore");
    void FieldPath.documentId();
    void FieldValue.serverTimestamp();
    void Timestamp.now();
    const db = getFirestore(app, "skatehubba");
    await Promise.all([
      attempt(() => db.collection("users").limit(1).get()),
      attempt(() => db.collectionGroup("clips").where("uid", "==", PROBE_UID).limit(1).get()),
      attempt(() => {
        const b = db.batch();
        b.delete(db.doc(`users/${PROBE_UID}`));
        return b.commit();
      }),
      attempt(() => db.runTransaction(async (tx) => tx.get(db.doc(`users/${PROBE_UID}`)))),
    ]);
  },
  async "firebase-admin/storage"() {
    const app = await adminApp();
    const { getStorage } = await import("firebase-admin/storage");
    const bucket = getStorage(app).bucket(BUCKET);
    await attempt(() => bucket.getFiles({ prefix: `users/${PROBE_UID}/`, autoPaginate: false, maxResults: 1 }));
    await attempt(() => bucket.file(`users/${PROBE_UID}/probe`).delete({ ignoreNotFound: true }));
  },
  async "firebase-admin/auth"() {
    const app = await adminApp();
    const { getAuth } = await import("firebase-admin/auth");
    const auth = getAuth(app);
    await attempt(() => auth.verifyIdToken(fakeIdToken(), true));
    await attempt(() => auth.revokeRefreshTokens(PROBE_UID));
    await attempt(() => auth.deleteUser(PROBE_UID));
  },
  async "firebase-admin/messaging"() {
    const app = await adminApp();
    const { getMessaging } = await import("firebase-admin/messaging");
    await attempt(() =>
      getMessaging(app).sendEachForMulticast({ tokens: ["api-load-guard-token"], data: { kind: "probe" } }),
    );
  },
  async "@sentry/node"(apiDir) {
    process.env.SENTRY_DSN = DUMMY_DSN;
    const sentry = await import(pathToFileURL(join(apiDir, "api/_sentry.js")).href);
    const sdk = await sentry.ensureSentry();
    if (!sdk) throw new Error("ensureSentry() returned null with a DSN set: @sentry/node failed to load");
    sentry.captureServerError("api_load_guard_probe", new Error("probe"), {});
    await sentry.flushServerErrors(500);
  },
  async "api/account/delete"(apiDir) {
    const sa = demoServiceAccount();
    process.env.SENTRY_DSN = DUMMY_DSN;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      type: "service_account",
      project_id: sa.projectId,
      client_email: sa.clientEmail,
      private_key: sa.privateKey,
    });
    const load = (p) => import(pathToFileURL(join(apiDir, p)).href);
    const { default: handler } = await load("api/account/delete.js");
    let status = 0;
    let body;
    const res = {
      status(code) {
        status = code;
        return res;
      },
      json(b) {
        body = b;
      },
      setHeader() {},
      end() {},
    };
    await attempt(() =>
      handler(
        { method: "POST", headers: { authorization: `Bearer ${fakeIdToken()}`, origin: "https://skatehubba.com" } },
        res,
      ),
    );
    // The network is off, so the token can't be checked: 401 invalid_token. Anything else
    // (init_failed, a throw) means the boot or auth path broke.
    if (status !== 401 || body?.code !== "invalid_token") {
      throw new Error(`handler answered ${status} ${body?.code ?? ""} (expected 401 invalid_token)`);
    }
    // The handler stops at the token; drive the erasure helpers it calls next, on the same
    // deps cascadeDeps() builds, so the Firestore and Storage lazy loads run too.
    const { getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const { getStorage } = await import("firebase-admin/storage");
    const [app] = getApps();
    const deps = { db: getFirestore(app, "skatehubba"), storage: getStorage(app), bucketName: BUCKET };
    const { deletePrefix } = await load("api/account/_cascadeUtil.js");
    const { deleteUserDataAsAdmin } = await load("api/account/_deleteUserData.js");
    await attempt(() => deletePrefix(deps, `users/${PROBE_UID}/`));
    await attempt(() => deleteUserDataAsAdmin(deps, PROBE_UID));
  },
};

function loadedPackages() {
  const req = createRequire(import.meta.url);
  return Object.keys(req.cache);
}

async function main() {
  const [name, apiDir] = process.argv.slice(2);
  const run = RUNNERS[name];
  if (!run || !PROBES[name]) {
    process.stdout.write(`${JSON.stringify({ ok: false, problems: [`unknown probe ${name}`] })}\n`);
    process.exit(2);
  }
  disableNetwork();
  const writeOut = process.stdout.write.bind(process.stdout);
  captureConsole();
  process.on("unhandledRejection", (e) => record(e));
  process.on("uncaughtException", (e) => record(e));
  const problems = [];
  try {
    await run(apiDir);
  } catch (err) {
    record(err);
    problems.push(`probe threw: ${err?.code ?? ""} ${String(err?.message ?? err).split("\n")[0]}`);
  }
  // Prefer the line naming the Node error (ERR_REQUIRE_ESM …) over a wrapper's code.
  const loadErrors = seen.filter((s) => MODULE_LOAD_ERROR.test(s));
  const loadError = loadErrors.find((s) => /ERR_[A-Z_]+|Cannot find/.test(s)) ?? loadErrors[0];
  if (loadError) problems.unshift(`module load failure: ${loadError.split("\n").slice(0, 3).join(" | ")}`);
  const cache = loadedPackages();
  for (const pkg of PROBES[name].mustLoad) {
    if (!cache.some((k) => k.includes(`/node_modules/${pkg}/`))) problems.push(`never loaded ${pkg}`);
  }
  writeOut(`${JSON.stringify({ ok: problems.length === 0, problems })}\n`);
  process.exit(problems.length === 0 ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
