/**
 * Account deletion endpoint — `POST /api/account/delete`.
 *
 * Replaces a client-side flow that could not work. See `_deleteUserData.ts` for
 * why: the old code deleted the Auth user first, which signs the SDK out, and
 * then asked the signed-out client to erase its own rule-protected data. Every
 * deletion silently orphaned 100% of the user's personal data while telling the
 * user it had succeeded — and `docs/STORE_PRIVACY_ANSWERS.md` promises Apple
 * and Google that this data is wiped.
 *
 * The ordering is now the safe one, which is only possible server-side:
 *
 *     verify caller → erase data with admin credentials → delete Auth LAST
 *
 * If erasure fails, the Auth user is left alive and the endpoint returns 500.
 * The account still works and the user can retry. That is strictly better than
 * the reverse: a live account with no data is a recoverable annoyance, whereas
 * orphaned personal data with no account to authorize its removal is a
 * compliance problem no retry can fix.
 *
 * ── Security boundary ──
 * This endpoint destroys data with admin credentials, so its auth check is the
 * only thing standing between a caller and irreversible erasure.
 *
 *   • Identity comes from a verified Firebase ID token, never from the body.
 *     There is deliberately no `uid` parameter — the uid is read out of the
 *     verified token, so the endpoint is incapable of deleting another account
 *     no matter what the caller sends.
 *   • `verifyIdToken(token, true)` checks revocation, so a token minted before
 *     a password change or session revocation is rejected rather than trusted
 *     for its full hour of validity.
 *   • A fresh-login requirement replaces the `auth/requires-recent-login` guard
 *     that Firebase enforced on the client `deleteUser()` path. Without it,
 *     moving deletion server-side would quietly *remove* a protection: any
 *     leaked ID token could erase an account. `auth_time` must be within
 *     RECENT_AUTH_WINDOW_S.
 *
 * Never-throw-to-the-platform contract, matching the cron handlers: every error
 * is converted to a JSON status response so a failure is diagnosable instead of
 * surfacing as an opaque platform 500.
 */

import { getAuth } from "firebase-admin/auth";
import { cert, getApps, initializeApp, type App, type ServiceAccount } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { describeInitFailure, parseServiceAccountJson } from "../cron/_serviceAccount.js";
import { deleteUserDataAsAdmin, type DeletionSummary } from "./_deleteUserData.js";
import { erasePosthogPerson } from "./_posthogErasure.js";
import { eraseUnderageSignIn, RacedCascadeError, type UnderageOutcome } from "./_underage.js";
import { hashIdentity, hashUid } from "../../src/utils/pii.js";
import { captureServerError, flushServerErrors, withSentry } from "../_sentry.js";
import { safeErrorCode } from "../_safeError.js";

/** Named Firestore database — must match `src/firebase.ts` FIRESTORE_DB_NAME. */
const FIRESTORE_DB_NAME = "skatehubba";

/**
 * How recently the caller must have authenticated, in seconds.
 *
 * This is the server-side stand-in for Firebase's `auth/requires-recent-login`.
 * Five minutes is long enough to survive a confirmation dialog and a slow
 * network, short enough that a token captured from an idle session is useless.
 */
const RECENT_AUTH_WINDOW_S = 5 * 60;

/** Minimal request/response shape — avoids a hard dep on @vercel/node types. */
interface ApiRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
}
interface ApiResponse {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end?: () => void;
}

/**
 * Origins allowed to call this endpoint cross-origin.
 *
 * On the web this is same-origin and CORS never engages. It engages on native:
 * the Capacitor webview serves the app from `https://localhost` (both
 * platforms, `capacitor.config.ts` sets `iosScheme`/`androidScheme: "https"`;
 * `capacitor://localhost` is Capacitor's iOS default and stays listed so a
 * scheme change can't silently break deletion), so a call to the deployed API
 * is cross-origin and the browser will preflight it. Without this the native
 * delete-account flow cannot work at all — which the App Store requires to exist.
 *
 * Plain-http dev origins (`DEV_ORIGINS`) are allowed only outside production
 * (`VERCEL_ENV !== "production"`: local `vercel dev`, preview deploys). In
 * production a page on someone's own machine has no reason to drive this
 * endpoint, and no shipped build serves from http.
 *
 * CORS is not the security boundary here; the ID token is. This allowlist only
 * decides who may *ask*, and every request still has to present a freshly
 * authenticated token for its own account. It is kept to an explicit list
 * rather than `*` so a hostile page cannot silently drive the endpoint with a
 * token it somehow obtained.
 */
const PRODUCTION_ORIGINS = [
  "https://skatehubba.com",
  "https://www.skatehubba.com",
  "capacitor://localhost",
  "https://localhost",
];
/** Local dev only: bare localhost, the Vite dev server and `vite preview`. */
const DEV_ORIGINS = ["http://localhost", "http://localhost:5173", "http://localhost:4173"];
const ALLOWED_ORIGINS = new Set(
  [
    ...PRODUCTION_ORIGINS,
    ...(process.env.VERCEL_ENV === "production" ? [] : DEV_ORIGINS),
    process.env.ACCOUNT_DELETE_ALLOWED_ORIGIN,
  ].filter((o): o is string => typeof o === "string" && o.length > 0),
);

/**
 * Reflect an allowlisted Origin back. `Vary: Origin` is mandatory: without it a
 * cache could serve one origin's CORS response to another.
 */
function applyCors(req: ApiRequest, res: ApiResponse): void {
  res.setHeader("Vary", "Origin");
  const raw = req.headers["origin"] ?? req.headers["Origin"];
  const origin = Array.isArray(raw) ? raw[0] : raw;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization");
    res.setHeader("Access-Control-Max-Age", "600");
  }
}

/** Machine-readable failure codes. The client branches on these, not on prose. */
type FailureCode =
  | "method_not_allowed"
  | "missing_token"
  | "invalid_token"
  | "requires_recent_login"
  | "init_failed"
  | "erasure_failed"
  | "has_profile";

let cachedApp: App | null = null;
let cachedBucketName: string | null = null;

/**
 * Lazily initialize firebase-admin from a service-account JSON in env, cached
 * across warm invocations.
 *
 * Unlike the cron handlers this also needs a Storage bucket. `initializeApp`
 * with only a credential has no default bucket, so the name is derived from the
 * service account's project id using the same convention as
 * Firebase's default bucket name (`${PROJECT_ID}.firebasestorage.app`), with an
 * env override for the case where the bucket was created under the older
 * `.appspot.com` naming.
 */
function getAdminApp(): App {
  if (!cachedApp) {
    const existing = getApps();
    if (existing.length > 0) {
      cachedApp = existing[0];
      cachedBucketName =
        process.env.FIREBASE_STORAGE_BUCKET ??
        cachedBucketName ??
        (existing[0].options.storageBucket as string | undefined) ??
        null;
    } else {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
      // Tolerates known hand-paste damage (expanded \n escapes, smart quotes)
      // and throws on anything unparseable or missing a field.
      const { account, repaired } = parseServiceAccountJson(raw);
      if (repaired) {
        console.warn(JSON.stringify({ event: "service_account_json_repaired" }));
      }
      const serviceAccount: ServiceAccount = account;
      cachedBucketName = process.env.FIREBASE_STORAGE_BUCKET ?? `${account.projectId}.firebasestorage.app`;
      cachedApp = initializeApp({ credential: cert(serviceAccount), storageBucket: cachedBucketName });
    }
  }
  // Resolve the bucket up front rather than discovering the problem mid-cascade.
  // A wrong bucket makes GCS throw NotFound on the first listing, which aborts
  // erasure in Phase 1 — before any Firestore write — so the account is left
  // fully intact rather than half-deleted. Catching it here turns that into a
  // clear init_failed instead of an erasure_failed with a confusing cause.
  if (!cachedBucketName) throw new Error("Storage bucket name could not be resolved");
  return cachedApp;
}

/** Extract the bearer value from an Authorization header. */
function readBearer(req: ApiRequest): string | null {
  const header = req.headers["authorization"] ?? req.headers["Authorization"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

/**
 * Structured log line. Never includes the ID token, the username, the email,
 * or the raw uid — a deletion audit trail should not itself be a store of the
 * personal data that was just erased, and these lines may be forwarded to
 * Sentry. Lines carry `uidHash` (`hashUid(uid)`, `src/utils/pii.ts`), the same
 * pseudonym Sentry and the client use; to trace one deletion, hash the uid the
 * same way and search for it (docs/DEPLOYMENT.md).
 */
function log(event: string, fields: Record<string, unknown>): void {
  console.warn(JSON.stringify({ event, ...fields }));
}

/**
 * An error's message for a log line, with the uid swapped for `[uid]`:
 * Firebase errors can quote it (`no doc users/<uid>`), and the line already
 * carries `uidHash`.
 */
function errorText(err: unknown, uid: string): string {
  const text = err instanceof Error ? err.message : String(err);
  return uid ? text.split(uid).join("[uid]") : text;
}

/**
 * Runs the PostHog person deletion and logs its outcome. Never throws.
 *
 * A failure, or a skip in production (the env is missing there, so every
 * deletion would silently miss PostHog), also sends a Sentry warning carrying
 * the distinct_id: it's the same pseudonym PostHog and Sentry already hold,
 * and the only handle left for the manual retry in docs/SENTRY_ALERTS.md once
 * the account is gone. A skip outside production is expected and only logged.
 */
async function reportPosthogErasure(uid: string): Promise<void> {
  const outcome = await erasePosthogPerson(uid);
  const uidHash = hashUid(uid);
  if (outcome.status === "queued") {
    log("account_delete_posthog_queued", { uidHash, personsFound: outcome.personsFound });
    return;
  }
  const event = outcome.status === "skipped" ? "account_delete_posthog_skipped" : "account_delete_posthog_failed";
  const distinctId = hashIdentity(uid);
  log(event, { uidHash, distinctId, reason: outcome.reason });
  if (outcome.status === "skipped" && process.env.VERCEL_ENV !== "production") return;
  captureServerError(
    event,
    new Error(`PostHog person deletion ${outcome.status}: ${outcome.reason}`),
    { uidHash, distinctId },
    { level: "warning" },
  );
}

/** What the full erasure cascade needs, for this app. */
function cascadeDeps(app: App) {
  return { db: getFirestore(app, FIRESTORE_DB_NAME), storage: getStorage(app), bucketName: cachedBucketName ?? "" };
}

/**
 * `?reason=underage`: the COPPA age gate blocked this sign-in before a profile
 * existed (see `_underage.ts`). With a profile it deletes nothing and answers
 * 409 `has_profile`; a real account is erased only through the normal path.
 *
 * Logs and Sentry get the same `uidHash` the client reports, never the uid:
 * under COPPA a persistent identifier is personal information, and the user
 * was told we keep nothing.
 */
async function handleUnderage(app: App, uid: string, res: ApiResponse): Promise<void> {
  const uidHash = hashUid(uid);
  let outcome: UnderageOutcome;
  try {
    outcome = await eraseUnderageSignIn(getFirestore(app, FIRESTORE_DB_NAME), getAuth(app), uid, () =>
      deleteUserDataAsAdmin(cascadeDeps(app), uid),
    );
  } catch (err) {
    // A raced cascade failure can't be retried (the Auth user is gone), so it
    // gets its own error-level event: an operator must erase the orphaned
    // profile (docs/SENTRY_ALERTS.md).
    const raced = err instanceof RacedCascadeError;
    const event = raced ? "account_delete_underage_raced_cascade_failed" : "account_delete_underage_failed";
    if (raced) console.error(JSON.stringify({ event, uidHash }));
    else log(event, { uidHash });
    captureServerError(event, raced ? err.inner : err, { uidHash }, { redactMessage: true });
    await flushServerErrors();
    fail(res, 500, "erasure_failed", "Could not remove this sign-in. Please try again.");
    return;
  }
  if (outcome === "has_profile") {
    log("account_delete_underage_has_profile", { uidHash });
    fail(res, 409, "has_profile", "This account has a profile. Delete it from Settings instead.");
    return;
  }
  log(outcome === "raced" ? "account_delete_underage_raced" : "account_delete_underage_success", { uidHash });
  res.status(200).json({ ok: true, authDeleted: true, mode: "underage" });
}

function fail(res: ApiResponse, status: number, code: FailureCode, message: string): void {
  res.status(status).json({ ok: false, code, message });
}

async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  applyCors(req, res);

  // Preflight. Answered before any auth work — a preflight carries no
  // Authorization header by design, so checking one here would break every
  // cross-origin call.
  if ((req.method ?? "GET").toUpperCase() === "OPTIONS") {
    res.status(204);
    if (res.end) res.end();
    else res.json(null);
    return;
  }

  if ((req.method ?? "GET").toUpperCase() !== "POST") {
    fail(res, 405, "method_not_allowed", "Use POST.");
    return;
  }

  const token = readBearer(req);
  if (!token) {
    fail(res, 401, "missing_token", "Missing Authorization: Bearer <Firebase ID token>.");
    return;
  }

  // ── Boot ──
  // Separated from token verification so a missing/damaged service account
  // reports as init_failed rather than masquerading as a bad token.
  let app: App;
  try {
    app = getAdminApp();
  } catch (err) {
    // Never err.message: a parse failure on FIREBASE_SERVICE_ACCOUNT_JSON quotes
    // part of the secret. The log gets the class and a fixed reason; Sentry
    // gets a message-free error (redactMessage).
    log("account_delete_init_failed", describeInitFailure(err));
    captureServerError("account_delete_init_failed", err, {}, { redactMessage: true });
    await flushServerErrors();
    fail(res, 500, "init_failed", "Server misconfiguration.");
    return;
  }

  // ── Identity ──
  let uid: string;
  let authTimeS: number;
  try {
    // checkRevoked=true: a token minted before a session revocation or password
    // change must not authorize erasure for the remainder of its validity.
    const decoded = await getAuth(app).verifyIdToken(token, true);
    uid = decoded.uid;
    authTimeS = typeof decoded.auth_time === "number" ? decoded.auth_time : 0;
  } catch (err) {
    // Deliberately coarse: distinguishing expired from revoked from malformed
    // would tell an attacker which of those a captured token is.
    // The log gets the code (auth/id-token-expired …) or class, never the message.
    log("account_delete_token_rejected", { code: safeErrorCode(err) });
    fail(res, 401, "invalid_token", "Invalid or expired credentials.");
    return;
  }

  const reason = req.query?.reason;
  if ((Array.isArray(reason) ? reason[0] : reason) === "underage") {
    await handleUnderage(app, uid, res);
    return;
  }

  const uidHash = hashUid(uid);
  const ageS = Math.floor(Date.now() / 1000) - authTimeS;
  if (!authTimeS || ageS > RECENT_AUTH_WINDOW_S) {
    log("account_delete_stale_auth", { uidHash, ageS });
    fail(res, 401, "requires_recent_login", "Please sign in again to confirm account deletion.");
    return;
  }

  // ── Erasure, then Auth ──
  log("account_delete_attempt", { uidHash });

  // Revoke first. The caller stays signed in for the whole cascade (seconds to
  // minutes), so without this the client can re-create what has just been
  // deleted — a push re-registration on app resume rewrites `pushTargets/{uid}`
  // after the cascade removed it, and the record is then orphaned when the Auth
  // user goes. Revocation does not impede the admin cascade, which uses
  // service-account credentials rather than the caller's token.
  //
  // Best-effort: a revocation failure must not block erasure, which is the
  // stronger privacy guarantee of the two.
  try {
    await getAuth(app).revokeRefreshTokens(uid);
  } catch (err) {
    log("account_delete_revoke_failed", { uidHash, error: errorText(err, uid) });
    // redactMessage: like the erasure and Auth errors below, it can quote the uid.
    captureServerError("account_delete_revoke_failed", err, { uidHash }, { level: "warning", redactMessage: true });
  }

  let summary: DeletionSummary;
  try {
    summary = await deleteUserDataAsAdmin(cascadeDeps(app), uid);
  } catch (err) {
    // The Auth user is intentionally left alive: the account keeps working and
    // the user can retry. Every phase is idempotent, so a retry resumes rather
    // than double-deleting.
    log("account_delete_erasure_failed", { uidHash, error: errorText(err, uid) });
    captureServerError("account_delete_erasure_failed", err, { uidHash }, { redactMessage: true });
    await flushServerErrors();
    fail(res, 500, "erasure_failed", "Could not delete your data. Your account is unchanged — please try again.");
    return;
  }

  // Analytics next, best-effort: PostHog trouble never fails or blocks a
  // deletion. Logged with the hash only, like every line here; the
  // account_delete_attempt line above and account_delete_success below are
  // the erasure audit trail.
  await reportPosthogErasure(uid);

  // Auth last. Reaching here means the data is already gone, so a failure now
  // leaves a sign-in-able account with no profile. The client treats that as
  // success and signs out; the next sign-in lands in profile setup, and a retry
  // of this endpoint will delete the Auth user (the cascade re-runs as a no-op).
  try {
    await getAuth(app).deleteUser(uid);
  } catch (err) {
    log("account_delete_auth_failed", { uidHash, error: errorText(err, uid) });
    captureServerError("account_delete_auth_failed", err, { uidHash }, { redactMessage: true });
    await flushServerErrors();
    res.status(200).json({ ok: true, authDeleted: false, summary });
    return;
  }

  log("account_delete_success", { uidHash, ...summary });
  // Sends a queued revoke_failed warning, if any; immediate when nothing is queued.
  await flushServerErrors();
  res.status(200).json({ ok: true, authDeleted: true, summary });
}

// Reports anything the handler throws despite the never-throw contract above.
export default withSentry("account_delete", handler);
