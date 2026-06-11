/**
 * Auto-referee cron sweep — server-side forfeit of expired turns.
 *
 * Runs on Vercel Cron (see `vercel.json` → `crons`). For each ACTIVE game whose
 * current turn is past its deadline, it applies the SAME game-state transition
 * the client's `forfeitExpiredTurn` would, computed via the shared
 * `decideExpiredForfeit` helper so the two paths can never diverge.
 *
 * GUARDRAIL NOTE: this is the one approved bend of the "no custom backend"
 * rule (repo owner sign-off). It is a *referee*, not a second source of truth —
 * every write goes through the same decision helper + an admin `runTransaction`
 * that re-reads and re-checks expiry, so it only ever writes a transition a
 * client could legally have written itself.
 *
 * Safety properties:
 *   • Auth: rejects any request without `Authorization: Bearer ${CRON_SECRET}`.
 *   • Idempotent: the transaction re-reads the game and re-runs the decision
 *     helper; if the game is no longer expired/active (another client or a
 *     prior sweep already advanced it) the transaction is a no-op.
 *   • Time-boxed: processes at most MAX_PER_RUN games; the cron re-runs every
 *     15 minutes to drain any backlog.
 *   • Fault-isolated: per-game try/catch — one bad game never aborts the run
 *     and the handler never throws to the platform.
 *   • Dry-run: `?dryRun=1` (or DRY_RUN=1) logs intended forfeits, writes nothing.
 */

import { timingSafeEqual } from "node:crypto";
import { cert, getApps, initializeApp, type App, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { decideExpiredForfeit, type ForfeitGameUpdate } from "../../src/services/turnForfeit.shared";
import { toGameDoc, type GameDoc } from "../../src/services/games.mappers";

/** Named Firestore database — must match `src/firebase.ts` FIRESTORE_DB_NAME. */
const FIRESTORE_DB_NAME = "skatehubba";

/** Max games to process per invocation. The cron repeats every 15 minutes. */
const MAX_PER_RUN = 100;

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

interface SweepSummary {
  scanned: number;
  forfeited: number;
  skipped: number;
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
function getAdminFirestore(): Firestore {
  if (!cachedApp) {
    const existing = getApps();
    if (existing.length > 0) {
      cachedApp = existing[0];
    } else {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      if (!raw) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
      }
      // Google emits snake_case keys; admin's ServiceAccount type is camelCase.
      // Map explicitly so the typed credential is exact and we fail loudly if
      // a required field is missing.
      const parsed = JSON.parse(raw) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };
      if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing required fields");
      }
      const serviceAccount: ServiceAccount = {
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key,
      };
      cachedApp = initializeApp({ credential: cert(serviceAccount) });
    }
  }
  // getFirestore(app, databaseId) targets the named "skatehubba" database, not
  // the project's (default) database.
  return getFirestore(cachedApp, FIRESTORE_DB_NAME);
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
 * Translate the SDK-agnostic `ForfeitGameUpdate` into an admin-SDK write
 * object. Mirrors `toWebGameUpdate` in games.turns.ts exactly, but uses the
 * admin SDK's Timestamp / FieldValue so the persisted document is identical.
 *
 * @internal Exported for the parity test that proves this stays byte-identical
 * to the client's `toWebGameUpdate`. Not part of the handler's public surface.
 */
export function toAdminGameUpdate(update: ForfeitGameUpdate): Record<string, unknown> {
  const out: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (update.status !== undefined) out.status = update.status;
  if (update.winner !== undefined) out.winner = update.winner;
  if (update.phase !== undefined) out.phase = update.phase;
  if (update.currentSetter !== undefined) out.currentSetter = update.currentSetter;
  if (update.currentTurn !== undefined) out.currentTurn = update.currentTurn;
  if (update.turnDeadlineMs !== undefined) out.turnDeadline = Timestamp.fromMillis(update.turnDeadlineMs);
  if (update.turnNumber !== undefined) out.turnNumber = update.turnNumber;
  if (update.p1Letters !== undefined) out.p1Letters = update.p1Letters;
  if (update.p2Letters !== undefined) out.p2Letters = update.p2Letters;
  if (update.judgeReviewFor !== undefined) out.judgeReviewFor = update.judgeReviewFor;
  if (update.appendTurnRecord !== undefined) out.turnHistory = FieldValue.arrayUnion(update.appendTurnRecord);
  return out;
}

/** Build the landed-clip doc id — mirrors clipId() in clips.mappers.ts. */
function clipId(gameId: string, turnNumber: number, role: "set" | "match"): string {
  return `${gameId}_${turnNumber}_${role}`;
}

/**
 * Process one game inside an admin transaction. Re-reads + re-decides, so it is
 * a no-op when the game is no longer eligible. Returns whether it forfeited.
 */
async function sweepOneGame(db: Firestore, gameId: string, nowMs: number, dryRun: boolean): Promise<boolean> {
  const gameRef = db.collection("games").doc(gameId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) return false;

    // toGameDoc only reads { id, data() } — admin DocumentSnapshot satisfies it.
    const game: GameDoc = toGameDoc({ id: snap.id, data: () => snap.data() as Record<string, unknown> });

    const decision = decideExpiredForfeit(game, nowMs, gameId);
    if (!decision) return false; // idempotent no-op: already resolved / not expired

    if (dryRun) return true;

    tx.update(gameRef, toAdminGameUpdate(decision.gameUpdate));

    // disputeAccept also writes the confirmed landed clips for the feed,
    // mirroring writeLandedClipsInTransaction in clips.writes.ts.
    if (decision.landedClips) {
      const c = decision.landedClips;
      const createdAt = FieldValue.serverTimestamp();
      if (c.setVideoUrl) {
        tx.set(db.collection("clips").doc(clipId(c.gameId, c.turnNumber, "set")), {
          gameId: c.gameId,
          turnNumber: c.turnNumber,
          role: "set",
          playerUid: c.setterUid,
          playerUsername: c.setterUsername,
          trickName: c.trickName,
          videoUrl: c.setVideoUrl,
          spotId: c.spotId,
          moderationStatus: "active",
          upvoteCount: 0,
          createdAt,
        });
      }
      if (c.matcherLanded && c.matchVideoUrl) {
        tx.set(db.collection("clips").doc(clipId(c.gameId, c.turnNumber, "match")), {
          gameId: c.gameId,
          turnNumber: c.turnNumber,
          role: "match",
          playerUid: c.matcherUid,
          playerUsername: c.matcherUsername,
          trickName: c.trickName,
          videoUrl: c.matchVideoUrl,
          spotId: c.spotId,
          moderationStatus: "active",
          upvoteCount: 0,
          createdAt,
        });
      }
    }

    return true;
  });
}

export default async function handler(req: CronRequest, res: CronResponse): Promise<void> {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const dryRun = isDryRun(req);
  const summary: SweepSummary = { scanned: 0, forfeited: 0, skipped: 0, errors: 0, dryRun };

  let db: Firestore;
  try {
    db = getAdminFirestore();
  } catch (err) {
    // Misconfiguration (missing/malformed service account) — surface as 500.
    res.status(500).json({ error: "init_failed", message: err instanceof Error ? err.message : String(err) });
    return;
  }

  try {
    const nowTs = Timestamp.fromMillis(Date.now());
    // Eligibility query mirrors the client's expiry check: active games whose
    // turnDeadline is in the past. Ordered + capped so each run is time-boxed.
    const candidates = await db
      .collection("games")
      .where("status", "==", "active")
      .where("turnDeadline", "<=", nowTs)
      .orderBy("turnDeadline", "asc")
      .limit(MAX_PER_RUN)
      .get();

    for (const docSnap of candidates.docs) {
      summary.scanned += 1;
      // Re-read Date.now() per game so a long batch uses a current clock for
      // each transaction's expiry re-check.
      try {
        const forfeited = await sweepOneGame(db, docSnap.id, Date.now(), dryRun);
        if (forfeited) summary.forfeited += 1;
        else summary.skipped += 1;
      } catch (err) {
        summary.errors += 1;
        console.warn(
          JSON.stringify({
            event: "sweep_game_failed",
            gameId: docSnap.id,
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    res.status(200).json(summary);
  } catch (err) {
    // Query-level failure (index missing, permission, etc). Never throw to the
    // platform — return what we have plus the error so the cron logs surface it.
    console.warn(JSON.stringify({ event: "sweep_failed", message: err instanceof Error ? err.message : String(err) }));
    res.status(500).json({ ...summary, error: "sweep_failed" });
  }
}
