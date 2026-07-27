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
 * reports as dead, and deletes what it processed.
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

import { timingSafeEqual } from "node:crypto";
import { cert, getApps, initializeApp, type App, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, FieldValue, type Firestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { parseServiceAccountJson } from "./_serviceAccount.js";

/** Named Firestore database — must match `src/firebase.ts` FIRESTORE_DB_NAME. */
const FIRESTORE_DB_NAME = "skatehubba";

/** Max dispatch docs to process per invocation. The cron repeats every 5 minutes. */
const MAX_PER_RUN = 200;

/**
 * Drop undelivered pushes older than this instead of sending them. Matches the
 * TTL=86400 (seconds) the replaced extension config carried.
 */
const PUSH_TTL_MS = 24 * 60 * 60 * 1000;

/** Collections — mirror the constants in src/services/pushDispatch.ts. */
const PUSH_DISPATCH_COLLECTION = "push_dispatch";
const PUSH_TARGETS_COLLECTION = "pushTargets";

/** Owner-only canonical token list — mirrors PRIVATE_PROFILE_DOC_ID in users.ts. */
const PRIVATE_PROFILE_DOC_ID = "profile";

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

/** Minimal request/response shape — avoids a hard dep on @vercel/node types. */
interface CronRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  url?: string;
}
interface CronResponse {
  status: (code: number) => CronResponse;
  json: (body: unknown) => void;
}

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
  /** Docs left in place for the next run after a transient failure. */
  errors: number;
  dryRun: boolean;
}

let cachedApp: App | null = null;

/**
 * Lazily initialize firebase-admin from a service-account JSON in env. Cached
 * across warm invocations. Throws (caught by the handler) if the env is
 * missing or malformed so the misconfiguration surfaces as a 500, not a
 * silent no-op.
 */
function getAdminApp(): App {
  if (!cachedApp) {
    const existing = getApps();
    if (existing.length > 0) {
      cachedApp = existing[0];
    } else {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      if (!raw) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
      }
      // Tolerates the hand-paste mangle (real newlines inside private_key)
      // and throws on anything unparseable or missing a required field.
      const serviceAccount: ServiceAccount = parseServiceAccountJson(raw);
      cachedApp = initializeApp({ credential: cert(serviceAccount) });
    }
  }
  return cachedApp;
}

/**
 * Constant-time bearer check against CRON_SECRET.
 *
 * Fail-closed: returns false when CRON_SECRET is unset, the header is missing,
 * or it is empty. The token comparison uses `crypto.timingSafeEqual` so a
 * network attacker cannot recover the secret byte-by-byte via response timing.
 * timingSafeEqual throws on unequal-length buffers, so we length-guard first —
 * the length check itself is not constant-time, but only leaks the secret's
 * length, not its bytes.
 */
function isAuthorized(req: CronRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers["authorization"] ?? req.headers["Authorization"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(value);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function isDryRun(req: CronRequest): boolean {
  if (process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true") return true;
  const q = req.query?.["dryRun"];
  const value = Array.isArray(q) ? q[0] : q;
  if (value === "1" || value === "true") return true;
  // Fall back to parsing the raw URL when the platform didn't pre-parse query.
  if (req.url && /[?&]dryRun=(1|true)\b/.test(req.url)) return true;
  return false;
}

/**
 * The subset of a /push_dispatch doc this handler needs, after validation.
 * `buildDispatchDoc` in src/services/pushDispatch.ts is the authoring contract;
 * the sweep cron's `buildAdminDispatchDoc` writes the same shape.
 */
interface DispatchPayload {
  tokens: string[];
  title: string;
  body: string;
  data: Record<string, string>;
  recipientUid: string;
  createdAtMs: number | null;
}

/**
 * Validate a dispatch doc against the authoring contract.
 *
 * Returns null for anything that does not match, which the caller treats as
 * malformed-and-deletable. We validate rather than trust because /push_dispatch
 * is client-writable: firestore.rules constrains the shape hard, but a doc
 * written before a rules tighten (or by a future writer) must never be able to
 * crash the drain or push an unbounded payload to a user's device.
 */
function parseDispatchDoc(raw: Record<string, unknown>): DispatchPayload | null {
  const tokensRaw = raw.tokens;
  if (!Array.isArray(tokensRaw)) return null;
  const tokens = tokensRaw.filter((t): t is string => typeof t === "string" && t.length > 0);
  if (tokens.length === 0) return null;

  const notification = raw.notification;
  if (typeof notification !== "object" || notification === null) return null;
  const { title, body } = notification as { title?: unknown; body?: unknown };
  if (typeof title !== "string" || typeof body !== "string") return null;

  const recipientUid = raw.recipientUid;
  if (typeof recipientUid !== "string" || recipientUid.length === 0) return null;

  // FCM requires every `data` value to be a string. The authoring path only
  // writes strings, but a non-string here would make the whole send throw and
  // wedge the doc in the queue forever — drop the offending key instead.
  const data: Record<string, string> = {};
  const dataRaw = raw.data;
  if (typeof dataRaw === "object" && dataRaw !== null) {
    for (const [k, v] of Object.entries(dataRaw as Record<string, unknown>)) {
      if (typeof v === "string") data[k] = v;
    }
  }

  // createdAt is a server Timestamp on every legitimate doc. A doc whose
  // timestamp has not resolved yet (or is absent) gets a null age and is
  // treated as "too new to expire" rather than being dropped.
  const createdAt = raw.createdAt;
  const createdAtMs =
    typeof createdAt === "object" &&
    createdAt !== null &&
    typeof (createdAt as { toMillis?: unknown }).toMillis === "function"
      ? (createdAt as { toMillis: () => number }).toMillis()
      : null;

  return { tokens, title, body, data, recipientUid, createdAtMs };
}

/**
 * Remove tokens FCM reported as permanently dead from BOTH the cross-readable
 * mirror and the owner-only canonical list, keeping the two in lockstep.
 *
 * Scoping note (security): the tokens passed here always come from the dispatch
 * doc's own `tokens` array, and the /push_dispatch create rule enforces
 * `tokens.hasOnly(pushTargets[recipientUid].tokens)`. So a sender can only ever
 * name tokens that genuinely belong to the recipient — a crafted dispatch doc
 * cannot make this prune an unrelated user's devices. The prune is further
 * gated on FCM itself declaring the token dead.
 */
async function pruneDeadTokens(db: Firestore, recipientUid: string, dead: string[]): Promise<number> {
  if (dead.length === 0) return 0;
  try {
    await Promise.all([
      db
        .collection(PUSH_TARGETS_COLLECTION)
        .doc(recipientUid)
        .set({ tokens: FieldValue.arrayRemove(...dead), updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
      db
        .collection("users")
        .doc(recipientUid)
        .collection("private")
        .doc(PRIVATE_PROFILE_DOC_ID)
        .set({ fcmTokens: FieldValue.arrayRemove(...dead) }, { merge: true }),
    ]);
    return dead.length;
  } catch (err) {
    // Best-effort: a leaked stale token costs one wasted FCM call per dispatch
    // and is re-pruned on the next attempt. Never fail the drain over it.
    console.warn(
      JSON.stringify({
        event: "drain_prune_failed",
        recipientUid,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return 0;
  }
}

export default async function handler(req: CronRequest, res: CronResponse): Promise<void> {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "unauthorized" });
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
    errors: 0,
    dryRun,
  };

  let app: App;
  let db: Firestore;
  try {
    app = getAdminApp();
    db = getFirestore(app, FIRESTORE_DB_NAME);
  } catch (err) {
    // Misconfiguration (missing/malformed service account) — surface as 500.
    res.status(500).json({ error: "init_failed", message: err instanceof Error ? err.message : String(err) });
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

        if (dryRun) {
          summary.sent += 1;
          continue;
        }

        const response = await messaging.sendEachForMulticast({
          tokens: payload.tokens,
          notification: { title: payload.title, body: payload.body },
          data: payload.data,
        });

        // Only reached when FCM accepted the request. A throw above leaves the
        // doc in place for the next run (see the at-least-once note in the
        // file header).
        summary.sent += 1;
        summary.failedTokens += response.failureCount;

        const dead: string[] = [];
        response.responses.forEach((r, i) => {
          if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) {
            dead.push(payload.tokens[i]);
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
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    res.status(200).json(summary);
  } catch (err) {
    // Query-level failure (index missing, permission, etc). Never throw to the
    // platform — return what we have plus the error so the cron logs surface it.
    console.warn(JSON.stringify({ event: "drain_failed", message: err instanceof Error ? err.message : String(err) }));
    res.status(500).json({ ...summary, error: "drain_failed" });
  }
}
