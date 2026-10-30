/**
 * Push dispatch drain — the consumer for /push_dispatch.
 *
 * WHY THIS EXISTS: `firebase.json` used to declare
 * `"extensions": { "firestore-send-fcm": "firebase/firestore-send-fcm@0.1.16" }`
 * and every comment in the codebase described that extension as the thing that
 * read /push_dispatch and called the FCM API. That extension does not exist —
 * extensions.dev returns 404 for `firebase/firestore-send-fcm` (while
 * `firebase/firestore-send-email` at the identical URL shape returns 200), the
 * registry has no FCM extension at all, and there was never a local
 * `extensions/firestore-send-fcm/` manifest. Nothing consumed /push_dispatch, so
 * every dispatch doc the client and the sweep cron wrote was validated,
 * rate-limited, and then left to rot. No OS-level push was ever delivered.
 *
 * This handler is that consumer. It reads the oldest pending dispatch docs,
 * sends them through the FCM API with admin credentials, prunes tokens FCM
 * reports as dead (and drops their platform tags), re-checks Roll Dice pushes
 * against the recipient's platform tags so an iPhone never gets one while dice
 * is off there, and deletes what it processed. The live courier is the Cloud
 * Function (functions/src/push/drain.ts); this endpoint is manual-only
 * (workflow_dispatch) and must stay behaviourally in lockstep with it.
 *
 * GUARDRAIL NOTE: this rides the same approved bend of the "no custom backend"
 * rule as `sweep-expired-turns.ts` (repo owner sign-off) and follows that file's
 * shape deliberately — same admin-init, same constant-time bearer auth, same
 * dry-run switch, same never-throw-to-the-platform contract. It is a *courier*,
 * not a source of truth: it makes no game-state decisions and writes nothing
 * except token pruning and the deletion of docs it has finished with.
 *
 * Safety properties:
 *   • Auth: rejects any request without `Authorization: Bearer ${CRON_SECRET}`.
 *   • At-least-once, never at-most-once: the doc is deleted only AFTER FCM has
 *     accepted the send. If the invocation dies between send and delete the
 *     next run re-sends — a duplicate push is a far better failure than a
 *     silently dropped one. Overlapping runs are additionally prevented by the
 *     `concurrency` group in .github/workflows/drain-push-dispatch.yml.
 *   • TTL: docs older than PUSH_TTL_MS are deleted unsent. SKATE turn deadlines
 *     are 24h, so a stale "your turn" must never wake a phone the day after the
 *     turn already auto-forfeited. Preserves the TTL=86400 semantics of the
 *     extension config this replaces.
 *   • Fault-isolated: per-doc try/catch — one bad doc never aborts the run and
 *     the handler never throws to the platform.
 *   • Time-boxed: at most MAX_PER_RUN docs per invocation; the cron re-runs
 *     every 5 minutes to drain any backlog.
 *   • Dry-run: `?dryRun=1` (or DRY_RUN=1) reports what it would send, sends and
 *     deletes nothing.
 */

import type { App } from "firebase-admin/app";
import type { Firestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { adminAppFromEnv, adminFirestore } from "./_adminApp.js";
import { isAuthorized, isDryRun, type CronRequest, type CronResponse } from "./_cronRequest.js";
import { describeInitFailure } from "./_serviceAccount.js";
import { diceEligibleTokens, isDicePush, mirrorTokens } from "./_pushPlatforms.js";
import { webpushOptions } from "./_pushWebpush.js";
import { parseDispatchDoc, pruneDeadTokens, PUSH_TARGETS_COLLECTION } from "./_pushDrain.js";
import { captureServerError, flushServerErrors, withSentry } from "../_sentry.js";
import { safeErrorCode } from "../_safeError.js";

/** Max dispatch docs to process per invocation. The cron repeats every 5 minutes. */
const MAX_PER_RUN = 200;

/**
 * Drop undelivered pushes older than this instead of sending them. Matches the
 * TTL=86400 (seconds) the replaced extension config carried.
 */
const PUSH_TTL_MS = 24 * 60 * 60 * 1000;

/** Collection — mirrors the constant in src/services/pushDispatch.ts. */
const PUSH_DISPATCH_COLLECTION = "push_dispatch";

/**
 * FCM error codes that mean "this token is permanently dead, stop sending to
 * it". Anything else (quota, unavailable, internal) is transient and must NOT
 * cost the user a registered device.
 */
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

interface DrainSummary {
  /** Docs read from the queue. */
  scanned: number;
  /** Docs handed to FCM (one doc may fan out to several tokens). */
  sent: number;
  /** Individual token deliveries FCM rejected. */
  failedTokens: number;
  /** Docs deleted unsent because they aged past PUSH_TTL_MS. */
  expired: number;
  /** Docs deleted unsent because their payload did not match the contract. */
  malformed: number;
  /** Dead tokens removed from the recipient's mirror + private profile. */
  pruned: number;
  /** Dice pushes dropped because no android/web token remained. */
  filtered: number;
  /** Docs left in place for the next run after a transient failure. */
  errors: number;
  dryRun: boolean;
}

let cachedApp: App | null = null;

/** Cached across warm invocations; see ./_adminApp.ts. */
function getAdminApp(): App {
  cachedApp ??= adminAppFromEnv();
  return cachedApp;
}

async function handler(req: CronRequest, res: CronResponse): Promise<void> {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  // Auth-first, then verb: this endpoint mutates state (deletes/prunes), so
  // reject any non-GET method (the Vercel/GitHub Actions cron calls it with
  // GET). Kept after the auth check so the allowed verb is never disclosed to
  // unauthenticated callers.
  if (req.method && req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const dryRun = isDryRun(req);
  const summary: DrainSummary = {
    scanned: 0,
    sent: 0,
    failedTokens: 0,
    expired: 0,
    malformed: 0,
    pruned: 0,
    filtered: 0,
    errors: 0,
    dryRun,
  };

  let app: App;
  let db: Firestore;
  try {
    app = getAdminApp();
    db = adminFirestore(app);
  } catch (err) {
    // Misconfiguration (missing/malformed service account) — surface as 500.
    // Never err.message, in the log or the body: a JSON.parse failure on
    // FIREBASE_SERVICE_ACCOUNT_JSON quotes part of the secret.
    console.warn(JSON.stringify({ event: "init_failed", ...describeInitFailure(err) }));
    captureServerError("drain_init_failed", err, {}, { redactMessage: true });
    await flushServerErrors();
    res.status(500).json({ error: "init_failed", message: "Server misconfiguration." });
    return;
  }

  try {
    const messaging = getMessaging(app);
    // Oldest first so a backlog drains in the order it accumulated and no doc
    // can be starved behind a continuously-refilling head of the queue.
    const pending = await db.collection(PUSH_DISPATCH_COLLECTION).orderBy("createdAt", "asc").limit(MAX_PER_RUN).get();

    for (const docSnap of pending.docs) {
      summary.scanned += 1;
      try {
        const payload = parseDispatchDoc(docSnap.data() as Record<string, unknown>);

        if (!payload) {
          summary.malformed += 1;
          if (!dryRun) await docSnap.ref.delete();
          continue;
        }

        if (payload.createdAtMs !== null && Date.now() - payload.createdAtMs > PUSH_TTL_MS) {
          summary.expired += 1;
          if (!dryRun) await docSnap.ref.delete();
          continue;
        }

        // One mirror read serves both the token lookup (doc names none, M1)
        // and the dice platform check.
        const needsMirror = payload.tokens === null || isDicePush(payload.data);
        const mirror = needsMirror
          ? (await db.collection(PUSH_TARGETS_COLLECTION).doc(payload.recipientUid).get()).data()
          : undefined;
        let tokens = payload.tokens ?? mirrorTokens(mirror);
        if (isDicePush(payload.data)) tokens = diceEligibleTokens(mirror, tokens);
        if (tokens.length === 0) {
          summary.filtered += 1;
          if (!dryRun) await docSnap.ref.delete();
          continue;
        }

        if (dryRun) {
          summary.sent += 1;
          continue;
        }

        const response = await messaging.sendEachForMulticast({
          tokens,
          notification: { title: payload.title, body: payload.body },
          data: payload.data,
          // Tap link, icon and per-game tag for web tokens (see _pushWebpush.ts).
          webpush: webpushOptions(payload.data),
        });

        // Only reached when FCM accepted the request. A throw above leaves the
        // doc in place for the next run (see the at-least-once note in the
        // file header).
        summary.sent += 1;
        summary.failedTokens += response.failureCount;

        const dead: string[] = [];
        response.responses.forEach((r, i) => {
          if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) {
            dead.push(tokens[i]);
          }
        });
        summary.pruned += await pruneDeadTokens(db, payload.recipientUid, dead);

        await docSnap.ref.delete();
      } catch (err) {
        // Transient (network, quota, FCM 5xx): leave the doc for the next run.
        summary.errors += 1;
        console.warn(
          JSON.stringify({
            event: "drain_dispatch_failed",
            dispatchId: docSnap.id,
            code: safeErrorCode(err),
          }),
        );
        captureServerError("drain_dispatch_failed", err, { dispatchId: docSnap.id }, { level: "warning" });
      }
    }

    await flushServerErrors();
    res.status(200).json(summary);
  } catch (err) {
    // Query-level failure (index missing, permission, etc). Never throw to the
    // platform — return what we have plus the error so the cron logs surface it.
    console.warn(JSON.stringify({ event: "drain_failed", code: safeErrorCode(err) }));
    captureServerError("drain_failed", err);
    await flushServerErrors();
    res.status(500).json({ ...summary, error: "drain_failed" });
  }
}

export default withSentry("drain_push_dispatch", handler);
