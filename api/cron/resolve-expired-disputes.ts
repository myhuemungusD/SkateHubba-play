/**
 * Dispute referee cron — server-side close-out of expired binding trick disputes.
 *
 * Runs on GitHub Actions schedule (see
 * `.github/workflows/resolve-expired-disputes.yml`), which curls this
 * Vercel-hosted endpoint every ~15 minutes. It drives the two timed transitions
 * of the binding community trick-dispute feature (docs/DISPUTE_BINDING_DESIGN.md
 * §3.3, §3.4, §4, §5), applying the SAME game-state + stat effect a client would,
 * computed via the shared `decidePendingReviewExpiry` / `decideDisputeResolution`
 * helpers so the referee and any client preview can never diverge.
 *
 * GUARDRAIL NOTE: this is the second approved bend of the "no custom backend"
 * rule (owner sign-off per CHARTER §4.14 / DISPUTE_BINDING_DESIGN §6, phase 4),
 * modelled on `sweep-expired-turns.ts`. It is a *referee*, not a second source of
 * truth — every write goes through the shared decision helper + an admin
 * `runTransaction` that re-reads and re-checks eligibility, so it only ever
 * writes a transition the state machine already sanctions.
 *
 * Two eligibility passes, both time-boxed:
 *   (a) phase=='pendingReview' && reviewDeadline<=now → the deferred honor swap
 *       (auto-accept the un-disputed landed claim). No stats.
 *   (b) phase=='communityReview' && reviewDeadline<=now → tally the votes and
 *       apply the verdict (land/bail/tie/none) plus the four §2 stat counters.
 *
 * Safety properties (identical to the sweep referee):
 *   • Auth: rejects any request without `Authorization: Bearer ${CRON_SECRET}`.
 *   • Verb: rejects non-GET AFTER auth (so the allowed verb is never disclosed).
 *   • Idempotent: each transaction re-reads the game and re-checks phase +
 *     expiry; a resolved game no longer matches (phase advanced away from
 *     pending/communityReview), so a re-run is a no-op. The communityReview pass
 *     ALSO gates on the dispute doc's `resolutionApplied`/`status=='resolved'`
 *     flag — a belt-and-braces second layer so overlapping runs can never
 *     double-count a stat increment.
 *   • Time-boxed: processes at most MAX_PER_RUN games per phase.
 *   • Fault-isolated: per-game try/catch — one bad game never aborts the run and
 *     the handler never throws to the platform.
 *   • Dry-run: `?dryRun=1` (or DRY_RUN=1) logs intended resolutions, writes
 *     nothing.
 */

import { timingSafeEqual } from "node:crypto";
import { cert, getApps, initializeApp, type App, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import { parseServiceAccountJson } from "./_serviceAccount.js";
// Relative imports in this file's traced graph need explicit .js extensions:
// Vercel compiles each file separately (no bundling) and the ESM loader does
// not do extension resolution. Extensionless specifiers crash the function at
// cold start (ERR_MODULE_NOT_FOUND).
import {
  decideDisputeResolution,
  decidePendingReviewExpiry,
  type DisputeGameUpdate,
} from "../../src/services/dispute.resolution.shared.js";
import { toGameDoc, type GameDoc } from "../../src/services/games.mappers.js";

/** Named Firestore database — must match `src/firebase.ts` FIRESTORE_DB_NAME. */
const FIRESTORE_DB_NAME = "skatehubba";

/** Max games to process per phase per invocation. The cron repeats every 15 minutes. */
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

interface ResolveSummary {
  scanned: number;
  resolved: number;
  skipped: number;
  errors: number;
  dryRun: boolean;
}

let cachedApp: App | null = null;

/**
 * Lazily initialize firebase-admin from a service-account JSON in env. Cached
 * across warm invocations. Throws (caught by the handler) if the env is
 * missing or malformed so the misconfiguration surfaces as a 500, not a
 * silent no-op. Mirrors `getAdminFirestore` in sweep-expired-turns.ts.
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
      const { account, repaired } = parseServiceAccountJson(raw);
      if (repaired) {
        console.warn(JSON.stringify({ event: "service_account_json_repaired" }));
      }
      const serviceAccount: ServiceAccount = account;
      cachedApp = initializeApp({ credential: cert(serviceAccount) });
    }
  }
  // getFirestore(app, databaseId) targets the named "skatehubba" database, not
  // the project's (default) database.
  return getFirestore(cachedApp, FIRESTORE_DB_NAME);
}

/**
 * Constant-time bearer check against CRON_SECRET. Fail-closed: returns false
 * when CRON_SECRET is unset, the header is missing, or it is empty. Identical to
 * the sweep referee — the length-guard leaks only the secret's length, and the
 * byte compare is timing-safe.
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
 * Translate the SDK-agnostic `DisputeGameUpdate` into an admin-SDK write object.
 * Mirrors `toAdminGameUpdate` in sweep-expired-turns.ts (and would mirror a
 * client's web-SDK translation of the same helper output) so the persisted
 * document is identical regardless of which path resolves the dispute.
 *
 * `reviewFor`/`reviewDeadline` are ALWAYS cleared to null on resolution (the
 * review is over) — the helper types them non-optional, so they are always
 * emitted.
 *
 * @internal Exported for the parity test that proves this stays byte-identical
 * to a web-SDK translation of the same `DisputeGameUpdate`. Not part of the
 * handler's public surface.
 */
export function toAdminDisputeUpdate(update: DisputeGameUpdate): Record<string, unknown> {
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
  // matchVideoUrl is cleared (null) only on the tie/retry branch.
  if (update.matchVideoUrl !== undefined) out.matchVideoUrl = update.matchVideoUrl;
  // Always cleared — the review phase is resolved.
  out.reviewFor = update.reviewFor;
  out.reviewDeadline = update.reviewDeadline;
  if (update.appendTurnRecord !== undefined) out.turnHistory = FieldValue.arrayUnion(update.appendTurnRecord);
  return out;
}

/** Build the landed-clip doc id — mirrors clipId() in clips.mappers.ts. */
function clipId(gameId: string, turnNumber: number, role: "set" | "match"): string {
  return `${gameId}_${turnNumber}_${role}`;
}

/** Collection the in-app notification feed reads — mirrors notifications.ts. */
const NOTIFICATIONS_COLLECTION = "notifications";
/** Token mirror + dispatch collections — mirror pushDispatch.ts constants. */
const PUSH_TARGETS_COLLECTION = "pushTargets";
const PUSH_DISPATCH_COLLECTION = "push_dispatch";
/** Per-dispatch token cap — mirrors MAX_TOKENS_PER_DISPATCH in pushDispatch.ts. */
const MAX_TOKENS_PER_DISPATCH = 10;
/** User-visible string caps — mirror pushDispatch.ts. */
const MAX_TITLE_LEN = 80;
const MAX_BODY_LEN = 200;

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Deterministic notification doc id for a resolved review. Keying on
 * (gameId, turnNumber, kind) makes the notification write idempotent across
 * overlapping invocations. Mirrors notifyId() in sweep-expired-turns.ts.
 */
function notifyId(gameId: string, turnNumber: number, kind: string): string {
  return `${gameId}_${turnNumber}_${kind}_notify`;
}

/** Mirror of buildDispatchDoc in pushDispatch.ts, using the admin SDK. */
function buildAdminDispatchDoc(
  n: { senderUid: string; recipientUid: string; type: string; title: string; body: string },
  gameId: string,
  tokens: string[],
): Record<string, unknown> {
  return {
    tokens,
    notification: { title: truncate(n.title, MAX_TITLE_LEN), body: truncate(n.body, MAX_BODY_LEN) },
    data: { gameId, type: n.type, click_action: `/?game=${gameId}` },
    senderUid: n.senderUid,
    recipientUid: n.recipientUid,
    gameId,
    type: n.type,
    createdAt: FieldValue.serverTimestamp(),
  };
}

/** The opponent of `playerUid` in a two-player game. Mirrors the shared helper. */
function opponentOf(game: GameDoc, playerUid: string): string {
  return playerUid === game.player1Uid ? game.player2Uid : game.player1Uid;
}

/** Username of `playerUid` (only p1/p2 are valid inputs). */
function usernameOf(game: GameDoc, playerUid: string): string {
  return playerUid === game.player1Uid ? game.player1Username : game.player2Username;
}

/**
 * Coerce a persisted vote aggregate into a safe non-negative number. Inlined
 * (rather than importing disputes.mappers.ts) to keep the web Firebase SDK out
 * of the cron's runtime graph — mirrors `coerceVoteCount` in disputes.mappers.ts.
 */
function coerceVotes(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

/** A "your turn"/resolution notification descriptor. Same shape the sweep uses. */
interface ResolveNotification {
  senderUid: string;
  recipientUid: string;
  type: string;
  title: string;
  body: string;
}

/**
 * Build the resolution notification for the player now on the clock. Derived
 * from the game-state write's `currentTurn` (whoever must act next); the sender
 * is that player's opponent. Returns `null` for a terminal (game-complete) bail
 * — nobody's turn is next, exactly like the sweep's plain-forfeit branch.
 */
function buildResolveNotification(game: GameDoc, update: DisputeGameUpdate): ResolveNotification | null {
  if (update.status === "complete" || update.currentTurn === undefined) return null;
  const recipientUid = update.currentTurn;
  const senderUid = opponentOf(game, recipientUid);
  const trickName = game.currentTrickName || "Trick";
  // matching = tie/retry (matcher re-attempts); setting = a turn advanced.
  const retry = update.phase === "matching";
  return {
    senderUid,
    recipientUid,
    type: "your_turn",
    title: retry ? "Rematch!" : "Your Turn!",
    body: retry
      ? `The community was split on ${trickName} — re-attempt it.`
      : `The community weighed in. It's your turn — ${trickName}.`,
  };
}

/**
 * Write the confirmed landed clips (set + match) for a resolution where the
 * matcher's claim stood (land / none verdict, or the pendingReview auto-accept).
 * Mirrors writeLandedClipsInTransaction in clips.writes.ts / the sweep referee.
 */
function writeLandedClips(tx: Transaction, db: Firestore, game: GameDoc, matcherUid: string): void {
  const setterUid = game.currentSetter;
  const trickName = game.currentTrickName || "Trick";
  const createdAt = FieldValue.serverTimestamp();
  if (game.currentTrickVideoUrl) {
    tx.set(db.collection("clips").doc(clipId(game.id, game.turnNumber, "set")), {
      gameId: game.id,
      turnNumber: game.turnNumber,
      role: "set",
      playerUid: setterUid,
      playerUsername: usernameOf(game, setterUid),
      trickName,
      videoUrl: game.currentTrickVideoUrl,
      spotId: game.spotId ?? null,
      moderationStatus: "active",
      upvoteCount: 0,
      createdAt,
    });
  }
  if (game.matchVideoUrl) {
    tx.set(db.collection("clips").doc(clipId(game.id, game.turnNumber, "match")), {
      gameId: game.id,
      turnNumber: game.turnNumber,
      role: "match",
      playerUid: matcherUid,
      playerUsername: usernameOf(game, matcherUid),
      trickName,
      videoUrl: game.matchVideoUrl,
      spotId: game.spotId ?? null,
      moderationStatus: "active",
      upvoteCount: 0,
      createdAt,
    });
  }
}

/** Write the deterministic in-tx notification. Mirrors the sweep referee. */
function writeNotification(tx: Transaction, db: Firestore, game: GameDoc, kind: string, n: ResolveNotification): void {
  tx.set(db.collection(NOTIFICATIONS_COLLECTION).doc(notifyId(game.id, game.turnNumber, kind)), {
    senderUid: n.senderUid,
    recipientUid: n.recipientUid,
    type: n.type,
    title: n.title,
    body: n.body,
    gameId: game.id,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });
}

/** What one resolved game produced — drives the post-tx push fan-out. */
interface ResolveOneResult {
  resolved: boolean;
  push: ResolveNotification | null;
}

/**
 * Pass (a): a `pendingReview` game whose 24h accept/dispute window lapsed with
 * no dispute → the deferred honor swap. Re-reads + re-checks phase/expiry inside
 * the tx (idempotent no-op if already advanced). No stats — no dispute was
 * raised. Writes the game update, the landed clips (matcher's claim stood), and
 * the "your turn" notification.
 */
async function resolvePendingReview(
  db: Firestore,
  gameId: string,
  nowMs: number,
  dryRun: boolean,
): Promise<ResolveOneResult> {
  const gameRef = db.collection("games").doc(gameId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) return { resolved: false, push: null };

    const game: GameDoc = toGameDoc({ id: snap.id, data: () => snap.data() as Record<string, unknown> });

    // Idempotent re-check: only a still-pendingReview, still-expired game resolves.
    if (game.phase !== "pendingReview") return { resolved: false, push: null };
    const deadline = game.reviewDeadline?.toMillis?.() ?? 0;
    if (deadline === 0 || nowMs < deadline) return { resolved: false, push: null };

    if (dryRun) return { resolved: true, push: null };

    const update = decidePendingReviewExpiry(game, nowMs);
    const matcherUid = game.reviewFor ?? opponentOf(game, game.currentSetter);

    tx.update(gameRef, toAdminDisputeUpdate(update));
    writeLandedClips(tx, db, game, matcherUid);

    const n = buildResolveNotification(game, update);
    if (n) writeNotification(tx, db, game, "pending_expiry", n);

    return { resolved: true, push: n };
  });
}

/**
 * Pass (b): a `communityReview` game whose 24h vote window lapsed → tally the
 * dispute's votes and apply the verdict via the shared helper, in ONE admin
 * transaction: the game update, the four §2 stat deltas, the landed clips (on a
 * land/none verdict), and the dispute doc close-out (open → resolved).
 *
 * Idempotency is defence-in-depth: the game phase re-check (a resolved game is
 * no longer communityReview) is the primary gate; the dispute doc's
 * `resolutionApplied`/`status=='resolved'` flag is the second. Either alone
 * makes a re-run a no-op, so a stat increment can never double-count.
 */
async function resolveCommunityReview(
  db: Firestore,
  gameId: string,
  nowMs: number,
  dryRun: boolean,
): Promise<ResolveOneResult> {
  const gameRef = db.collection("games").doc(gameId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) return { resolved: false, push: null };

    const game: GameDoc = toGameDoc({ id: snap.id, data: () => snap.data() as Record<string, unknown> });

    // Primary idempotency gate + eligibility: still frozen in communityReview,
    // still past the vote deadline.
    if (game.phase !== "communityReview") return { resolved: false, push: null };
    const deadline = game.reviewDeadline?.toMillis?.() ?? 0;
    if (deadline === 0 || nowMs < deadline) return { resolved: false, push: null };

    const disputeRef = db.collection("disputes").doc(`${gameId}_${game.turnNumber}`);
    const disputeSnap = await tx.get(disputeRef);
    // A communityReview game always has its dispute doc (Gap B removed the
    // client delete). If it is somehow gone, skip rather than fabricate a
    // malformed doc — the game stays frozen for an operator to inspect.
    if (!disputeSnap.exists) {
      console.warn(JSON.stringify({ event: "resolve_missing_dispute", gameId }));
      return { resolved: false, push: null };
    }
    const dispute = disputeSnap.data() as Record<string, unknown>;
    // Secondary idempotency gate: an already-resolved dispute no-ops.
    if (dispute.status === "resolved" || dispute.resolutionApplied === true) {
      return { resolved: false, push: null };
    }

    if (dryRun) return { resolved: true, push: null };

    const tally = { landVotes: coerceVotes(dispute.landVotes), bailVotes: coerceVotes(dispute.bailVotes) };
    const decision = decideDisputeResolution(game, tally, nowMs);
    const matcherUid = game.reviewFor ?? opponentOf(game, game.currentSetter);

    // ── Game-state write ──
    tx.update(gameRef, toAdminDisputeUpdate(decision.gameUpdate));

    // ── The four public §2 stat counters (admin-only) ──
    const { claimer, disputer } = decision.statDeltas;
    tx.set(
      db.collection("users").doc(claimer.uid),
      { tricksDisputed: FieldValue.increment(claimer.tricksDisputed) },
      { merge: true },
    );
    tx.set(
      db.collection("users").doc(disputer.uid),
      {
        disputesRaised: FieldValue.increment(disputer.disputesRaised),
        disputesRight: FieldValue.increment(disputer.disputesRight),
        disputesWrong: FieldValue.increment(disputer.disputesWrong),
      },
      { merge: true },
    );

    // ── Landed clips only when the matcher's claim stood ──
    if (decision.verdict === "land" || decision.verdict === "none") {
      writeLandedClips(tx, db, game, matcherUid);
    }

    // ── Dispute close-out (open → resolved) with the idempotency flag ──
    tx.set(
      disputeRef,
      {
        status: "resolved",
        verdict: decision.verdict,
        resolutionApplied: true,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const n = buildResolveNotification(game, decision.gameUpdate);
    if (n) writeNotification(tx, db, game, `dispute_${decision.verdict}`, n);

    return { resolved: true, push: n };
  });
}

/**
 * Fire the OS-level push for a server-written notification, AFTER the game tx
 * committed. Reads the recipient's token mirror and writes a /push_dispatch doc
 * api/cron/drain-push-dispatch.ts drains. Best-effort. Mirrors the sweep referee.
 */
async function dispatchAdminPush(db: Firestore, gameId: string, n: ResolveNotification): Promise<void> {
  try {
    const targetSnap = await db.collection(PUSH_TARGETS_COLLECTION).doc(n.recipientUid).get();
    const raw = targetSnap.exists ? (targetSnap.data() as { tokens?: unknown }).tokens : undefined;
    const tokens = (Array.isArray(raw) ? raw : [])
      .filter((t): t is string => typeof t === "string" && t.length > 0)
      .slice(0, MAX_TOKENS_PER_DISPATCH);
    if (tokens.length === 0) return;
    await db.collection(PUSH_DISPATCH_COLLECTION).add(buildAdminDispatchDoc(n, gameId, tokens));
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "resolve_push_failed",
        gameId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/**
 * Run one eligibility pass: query capped candidates for `phase`, resolve each in
 * its own transaction, fan out the post-tx push, and fold the counts into the
 * summary. Fault-isolated per game. Shared by both phases so the two passes can
 * never drift in their fault-handling / dry-run semantics.
 */
async function runPass(
  db: Firestore,
  phase: "pendingReview" | "communityReview",
  resolveOne: (db: Firestore, gameId: string, nowMs: number, dryRun: boolean) => Promise<ResolveOneResult>,
  dryRun: boolean,
  summary: ResolveSummary,
): Promise<void> {
  const nowTs = Timestamp.fromMillis(Date.now());
  const candidates = await db
    .collection("games")
    .where("phase", "==", phase)
    .where("reviewDeadline", "<=", nowTs)
    .orderBy("reviewDeadline", "asc")
    .limit(MAX_PER_RUN)
    .get();

  for (const docSnap of candidates.docs) {
    summary.scanned += 1;
    try {
      const { resolved, push } = await resolveOne(db, docSnap.id, Date.now(), dryRun);
      if (resolved) summary.resolved += 1;
      else summary.skipped += 1;
      if (push) await dispatchAdminPush(db, docSnap.id, push);
    } catch (err) {
      summary.errors += 1;
      console.warn(
        JSON.stringify({
          event: "resolve_game_failed",
          phase,
          gameId: docSnap.id,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
}

export default async function handler(req: CronRequest, res: CronResponse): Promise<void> {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  // Auth-first, then verb: this endpoint mutates game state, so reject any
  // non-GET method. Kept after the auth check so the allowed verb is never
  // disclosed to unauthenticated callers.
  if (req.method && req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const dryRun = isDryRun(req);
  const summary: ResolveSummary = { scanned: 0, resolved: 0, skipped: 0, errors: 0, dryRun };

  let db: Firestore;
  try {
    db = getAdminFirestore();
  } catch (err) {
    res.status(500).json({ error: "init_failed", message: err instanceof Error ? err.message : String(err) });
    return;
  }

  try {
    // (a) deferred honor swap for un-disputed landed claims.
    await runPass(db, "pendingReview", resolvePendingReview, dryRun, summary);
    // (b) binding community verdict for disputed landed claims.
    await runPass(db, "communityReview", resolveCommunityReview, dryRun, summary);

    res.status(200).json(summary);
  } catch (err) {
    // Query-level failure (index missing, permission, etc). Never throw to the
    // platform — return what we have plus the error so the cron logs surface it.
    console.warn(
      JSON.stringify({ event: "resolve_failed", message: err instanceof Error ? err.message : String(err) }),
    );
    res.status(500).json({ ...summary, error: "resolve_failed" });
  }
}
