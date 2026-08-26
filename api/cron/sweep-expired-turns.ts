/**
 * Auto-referee cron sweep — server-side forfeit of expired turns.
 *
 * Scheduled by GitHub Actions, NOT Vercel Cron — see the every-15-minutes
 * schedule in `.github/workflows/sweep-expired-turns.yml`, which curls this
 * endpoint over HTTPS. Vercel's Hobby plan caps `crons` at once per day and a
 * sub-daily `crons` block breaks PR preview deploys, so `vercel.json` has no
 * `crons` key at all. For each ACTIVE game whose
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
import { parseServiceAccountJson } from "./_serviceAccount.js";
// Relative imports in this file's traced graph need explicit .js extensions:
// Vercel compiles each file separately (no bundling) and the ESM loader does
// not do extension resolution. Extensionless specifiers crash the function at
// cold start (ERR_MODULE_NOT_FOUND).
import { decideExpiredForfeit, type ForfeitGameUpdate } from "../../src/services/turnForfeit.shared.js";
import { toGameDoc, type GameDoc } from "../../src/services/games.mappers.js";

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
  /** Challenge notifications the client failed to write, backfilled by the server. */
  reconciled: number;
  /** "your turn ends soon" reminders emitted this run. */
  reminded: number;
  /** Failures inside the notification passes — never fail the forfeit sweep. */
  notifyErrors: number;
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
      // Tolerates known hand-paste damage (expanded \n escapes, smart
      // quotes) and throws on anything unparseable or missing a field.
      const { account, repaired } = parseServiceAccountJson(raw);
      if (repaired) {
        // Expected error path: the stored env value is damaged but
        // recoverable. Announce it on every cold start so the
        // misconfiguration gets fixed instead of silently absorbed forever.
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
 * Deterministic "your turn" notification doc id for a given resolved turn.
 * Keying on (gameId, turnNumber, kind) makes the notification write idempotent:
 * a re-run of the sweep over the same (now already-resolved) turn would no-op
 * anyway via decideExpiredForfeit, but a deterministic id is belt-and-braces in
 * case two overlapping invocations both read the still-expired doc.
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

/** What one swept game produced — drives the post-tx push fan-out. */
interface SweepOneResult {
  /** True when a transition was applied (or would be, under dry-run). */
  forfeited: boolean;
  /**
   * The "your turn" notification that was written in-tx, surfaced so the
   * handler can fire the OS-level push AFTER the tx commits (never inside it —
   * the dispatch reads /pushTargets and writes /push_dispatch, neither of which
   * belongs in the game tx). `null` for plain forfeit / dry-run / no-op.
   */
  push: { senderUid: string; recipientUid: string; type: string; title: string; body: string } | null;
}

/**
 * Process one game inside an admin transaction. Re-reads + re-decides, so it is
 * a no-op when the game is no longer eligible. Returns whether it forfeited and
 * the notification (if any) to push after the tx.
 */
async function sweepOneGame(db: Firestore, gameId: string, nowMs: number, dryRun: boolean): Promise<SweepOneResult> {
  const gameRef = db.collection("games").doc(gameId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) return { forfeited: false, push: null };

    // toGameDoc only reads { id, data() } — admin DocumentSnapshot satisfies it.
    const game: GameDoc = toGameDoc({ id: snap.id, data: () => snap.data() as Record<string, unknown> });

    const decision = decideExpiredForfeit(game, nowMs, gameId);
    if (!decision) return { forfeited: false, push: null }; // idempotent no-op

    if (dryRun) return { forfeited: true, push: null };

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

    // "Your turn" notification for the turn-advancing branches. Unlike the
    // client, the server ALWAYS writes it: the admin SDK bypasses
    // firestore.rules, so the self-notify constraint that gates the client
    // doesn't apply, and the recipient (the away player) is exactly who needs
    // alerting. Mirrors writeNotificationInTx's doc shape; the deterministic
    // id keeps the write idempotent across overlapping sweeps.
    const n = decision.notification;
    if (n) {
      tx.set(db.collection(NOTIFICATIONS_COLLECTION).doc(notifyId(gameId, game.turnNumber, decision.kind)), {
        senderUid: n.senderUid,
        recipientUid: n.recipientUid,
        type: n.type,
        title: n.title,
        body: n.body,
        gameId,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    return { forfeited: true, push: n };
  });
}

/**
 * Fire the OS-level push for a server-written notification, AFTER the game tx
 * committed. Reads the recipient's token mirror and writes a /push_dispatch doc
 * api/cron/drain-push-dispatch.ts drains. Best-effort: no tokens → no-op; any
 * failure is logged and swallowed so push health never fails the sweep.
 */
async function dispatchAdminPush(
  db: Firestore,
  gameId: string,
  n: { senderUid: string; recipientUid: string; type: string; title: string; body: string },
): Promise<void> {
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
        event: "sweep_push_failed",
        gameId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/* ────────────────────────────────────────────
 * Notification passes (backstop + reminder)
 * ──────────────────────────────────────────── */

/**
 * Grace period before the server backfills a missing challenge notification.
 * Long enough that a healthy client (which writes the notification immediately
 * after the game doc) is never raced, short enough that the opponent isn't left
 * waiting for the next 15-minute cron tick plus an hour.
 */
const CHALLENGE_GRACE_MS = 2 * 60_000;
/** Upper bound on the reconcile window — old misses are not worth waking anyone for. */
const CHALLENGE_MAX_AGE_MS = 24 * 60 * 60_000;
/** Reminder fires when the deadline is inside [now+1h45m, now+2h]. */
const REMINDER_LEAD_MAX_MS = 2 * 60 * 60_000;
const REMINDER_LEAD_MIN_MS = REMINDER_LEAD_MAX_MS - 15 * 60_000;
/** Per-pass candidate cap. Both passes re-run every 15 minutes. */
const NOTIFY_MAX_PER_RUN = 100;

/** Read a Firestore Timestamp-ish field as epoch millis, or null when absent/garbled. */
function millisOf(value: unknown): number | null {
  if (typeof value === "object" && value !== null && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Phases that FREEZE the game clock pending a review (docs/DISPUTE_BINDING_DESIGN.md
 * §3.1). Entering them opens a separate `reviewDeadline` and deliberately leaves
 * `turnDeadline` untouched, so a frozen game keeps drifting toward a turn
 * deadline that nobody is allowed to act on.
 */
const FROZEN_REVIEW_PHASES = new Set(["pendingReview", "communityReview"]);

/** Result accumulator shared by both notification passes. */
interface NotifyPassResult {
  written: number;
  errors: number;
}

/**
 * Write a server-authored notification at a deterministic id, stamp the
 * delete-resistant tombstone on the GAME doc in the same batch, and fan out
 * the push.
 *
 * Why the tombstone rides the same batch: the recipient can DELETE their
 * notification doc (the bell's dismiss is a real Firestore delete), so
 * "has this game been notified?" cannot be re-derived from /notifications.
 * The marker therefore lives on the game doc, which only the admin SDK writes.
 * Committing them together makes the pair all-or-nothing — a stamp without a
 * notification would silently swallow the alert, and a notification without a
 * stamp would be re-sent on the next tick.
 */
async function emitAdminNotification(
  db: Firestore,
  docId: string,
  gameId: string,
  n: { senderUid: string; recipientUid: string; type: string; title: string; body: string },
  tombstone: Record<string, unknown>,
): Promise<void> {
  const batch = db.batch();
  batch.set(db.collection(NOTIFICATIONS_COLLECTION).doc(docId), {
    senderUid: n.senderUid,
    recipientUid: n.recipientUid,
    type: n.type,
    title: n.title,
    body: n.body,
    gameId,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.update(db.collection("games").doc(gameId), tombstone);
  await batch.commit();
  await dispatchAdminPush(db, gameId, n);
}

/**
 * Backstop for the client's new_challenge notification.
 *
 * createGame awaits the notification write, but the write still happens AFTER
 * the game doc lands and outside its transaction (the /notifications create
 * rule resolves the recipient via a pre-commit `get()` on the game, so it
 * cannot be co-committed with the create). If the tab dies, goes offline, or
 * gets a rules rejection in that window, the challenged player is never told a
 * game exists. This pass finds still-active turn-1 games older than the grace
 * period that have not been marked notified, and writes one.
 *
 * Requires the (status, turnNumber, createdAt) composite index in
 * firestore.indexes.json.
 */
async function reconcileChallengeNotifications(
  db: Firestore,
  nowMs: number,
  dryRun: boolean,
): Promise<NotifyPassResult> {
  const result: NotifyPassResult = { written: 0, errors: 0 };

  const candidates = await db
    .collection("games")
    // status filter: a game that already ended (forfeit sweep, insta-quit)
    // must never produce a "New Challenge!" buzz for a dead game.
    .where("status", "==", "active")
    .where("turnNumber", "==", 1)
    .where("createdAt", ">=", Timestamp.fromMillis(nowMs - CHALLENGE_MAX_AGE_MS))
    .where("createdAt", "<=", Timestamp.fromMillis(nowMs - CHALLENGE_GRACE_MS))
    .orderBy("createdAt", "asc")
    .limit(NOTIFY_MAX_PER_RUN)
    .get();

  for (const docSnap of candidates.docs) {
    try {
      const data = docSnap.data() as Record<string, unknown>;
      // Tombstone first — this is the delete-resistant "already handled" mark.
      // Checked BEFORE the /notifications query because the recipient can
      // DELETE their notification doc (NotificationContext's dismiss is a real
      // delete): deriving "notified" from the collection alone re-created and
      // re-pushed a dismissed challenge every 15 minutes for the full 24h
      // window.
      if (data.challengeNotifiedAt !== undefined && data.challengeNotifiedAt !== null) continue;

      // Re-check the window against the doc itself: the query bounds are the
      // fast path, this is what makes the pass correct if the index/query ever
      // widens.
      const createdAtMs = millisOf(data.createdAt);
      if (createdAtMs === null) continue;
      const age = nowMs - createdAtMs;
      if (age < CHALLENGE_GRACE_MS || age > CHALLENGE_MAX_AGE_MS) continue;

      const senderUid = stringOf(data.player1Uid);
      const recipientUid = stringOf(data.player2Uid);
      if (!senderUid || !recipientUid) continue;

      const gameRef = db.collection("games").doc(docSnap.id);

      // Existence check by (gameId, type) rather than by the deterministic id:
      // the notification the CLIENT writes has a random id, and that is the
      // doc we're checking for. Requires the (gameId, type) index.
      const existing = await db
        .collection(NOTIFICATIONS_COLLECTION)
        .where("gameId", "==", docSnap.id)
        .where("type", "==", "new_challenge")
        .limit(1)
        .get();
      if (!existing.empty) {
        // Migration for games already in flight when the tombstone shipped:
        // the client's notification IS there, so stamp the game once and never
        // scan it again. The stamp outlives the recipient deleting the doc.
        if (!dryRun) await gameRef.update({ challengeNotifiedAt: FieldValue.serverTimestamp() });
        continue;
      }

      result.written += 1;
      if (dryRun) continue;

      const challenger = stringOf(data.player1Username) ?? "A skater";
      await emitAdminNotification(
        db,
        notifyId(docSnap.id, 1, "new_challenge"),
        docSnap.id,
        {
          senderUid,
          recipientUid,
          type: "new_challenge",
          title: "New Challenge!",
          body: `@${challenger} challenged you to S.K.A.T.E.`,
        },
        { challengeNotifiedAt: FieldValue.serverTimestamp() },
      );
    } catch (err) {
      result.errors += 1;
      console.warn(
        JSON.stringify({
          event: "challenge_reconcile_failed",
          gameId: docSnap.id,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  return result;
}

/**
 * One "your turn ends soon" reminder per turn, ~2h before the deadline.
 *
 * The 24h turn clock is long enough that a player who saw the original
 * notification in the morning can still time out by evening. The window is
 * [now+1h45m, now+2h] — one cron tick wide (15 min) so every deadline is caught
 * exactly once — and the `turnReminderSentFor` tombstone on the game doc makes a
 * double-tick a no-op instead of a second buzz.
 *
 * Reuses the existing (status, turnDeadline) composite index.
 */
async function remindUpcomingDeadlines(db: Firestore, nowMs: number, dryRun: boolean): Promise<NotifyPassResult> {
  const result: NotifyPassResult = { written: 0, errors: 0 };

  const candidates = await db
    .collection("games")
    .where("status", "==", "active")
    .where("turnDeadline", ">=", Timestamp.fromMillis(nowMs + REMINDER_LEAD_MIN_MS))
    .where("turnDeadline", "<=", Timestamp.fromMillis(nowMs + REMINDER_LEAD_MAX_MS))
    .orderBy("turnDeadline", "asc")
    .limit(NOTIFY_MAX_PER_RUN)
    .get();

  for (const docSnap of candidates.docs) {
    try {
      const data = docSnap.data() as Record<string, unknown>;
      const deadlineMs = millisOf(data.turnDeadline);
      if (deadlineMs === null) continue;
      const lead = deadlineMs - nowMs;
      if (lead < REMINDER_LEAD_MIN_MS || lead > REMINDER_LEAD_MAX_MS) continue;

      // A game frozen in pendingReview/communityReview keeps the turnDeadline it
      // carried when it froze (the freeze opens a SEPARATE reviewDeadline), so
      // it drifts through this window while `currentTurn` — the matcher who
      // already submitted — has no legal write. Never nag a player who cannot act.
      const phase = data.phase;
      if (typeof phase === "string" && FROZEN_REVIEW_PHASES.has(phase)) continue;

      const recipientUid = stringOf(data.currentTurn);
      if (!recipientUid) continue;
      const turnNumber = typeof data.turnNumber === "number" ? data.turnNumber : 0;

      // Idempotency: one reminder per (game, turn), forever. The marker lives on
      // the GAME doc, not on the notification doc — the recipient can delete the
      // notification from the bell, and a doc-existence pre-check would then
      // resurrect the reminder (unread, with a push) on the very next tick.
      if (data.turnReminderSentFor === turnNumber) continue;

      result.written += 1;
      if (dryRun) continue;

      // Sender is the OTHER participant — the /notifications shape wants a
      // sender, and "the person waiting on you" is the honest one.
      const p1 = stringOf(data.player1Uid);
      const p2 = stringOf(data.player2Uid);
      const senderUid = recipientUid === p1 ? p2 : p1;
      const opponent = stringOf(recipientUid === p1 ? data.player2Username : data.player1Username) ?? "your opponent";
      await emitAdminNotification(
        db,
        notifyId(docSnap.id, turnNumber, "turn_reminder"),
        docSnap.id,
        {
          senderUid: senderUid ?? recipientUid,
          recipientUid,
          type: "your_turn",
          title: "Turn ending soon",
          body: `Your turn vs @${opponent} ends in under 2 hours`,
        },
        { turnReminderSentFor: turnNumber },
      );
    } catch (err) {
      result.errors += 1;
      console.warn(
        JSON.stringify({
          event: "turn_reminder_failed",
          gameId: docSnap.id,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  return result;
}

/**
 * The notification passes, each tagged with the summary counter it feeds and a
 * stable log name.
 *
 * Tagged tuples rather than function identity / `fn.name`: the deployed bundle
 * is minified, so `pass.name` would log a mangled identifier, and `pass ===
 * reconcileChallengeNotifications` is a fragile way to route a counter.
 */
type NotifyPassKey = "reconciled" | "reminded";
type NotifyPass = (db: Firestore, nowMs: number, dryRun: boolean) => Promise<NotifyPassResult>;

const NOTIFY_PASSES: ReadonlyArray<readonly [NotifyPassKey, string, NotifyPass]> = [
  ["reconciled", "challenge_reconcile", reconcileChallengeNotifications],
  ["reminded", "turn_reminder", remindUpcomingDeadlines],
];

/**
 * Run both notification passes, folding their counters into the summary.
 * Query-level failures (e.g. a missing composite index) are logged and
 * swallowed: the forfeit sweep is the load-bearing job and must still report.
 */
async function runNotificationPasses(db: Firestore, summary: SweepSummary, dryRun: boolean): Promise<void> {
  for (const [key, name, run] of NOTIFY_PASSES) {
    try {
      const { written, errors } = await run(db, Date.now(), dryRun);
      summary[key] += written;
      summary.notifyErrors += errors;
    } catch (err) {
      summary.notifyErrors += 1;
      console.warn(
        JSON.stringify({
          event: "notify_pass_failed",
          pass: name,
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
  // non-GET method (the Vercel/GitHub Actions cron calls it with GET). Kept
  // after the auth check so the allowed verb is never disclosed to
  // unauthenticated callers.
  if (req.method && req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const dryRun = isDryRun(req);
  const summary: SweepSummary = {
    scanned: 0,
    forfeited: 0,
    skipped: 0,
    errors: 0,
    reconciled: 0,
    reminded: 0,
    notifyErrors: 0,
    dryRun,
  };

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
        const { forfeited, push } = await sweepOneGame(db, docSnap.id, Date.now(), dryRun);
        if (forfeited) summary.forfeited += 1;
        else summary.skipped += 1;
        // Fan out the OS push after the game tx committed. Skipped under
        // dry-run (push is null) and for plain forfeit (no next turn).
        if (push) await dispatchAdminPush(db, docSnap.id, push);
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

    // Notification passes run after the forfeit sweep so a slow reconcile can
    // never delay the state transitions the game actually depends on.
    await runNotificationPasses(db, summary, dryRun);

    res.status(200).json(summary);
  } catch (err) {
    // Query-level failure (index missing, permission, etc). Never throw to the
    // platform — return what we have plus the error so the cron logs surface it.
    console.warn(JSON.stringify({ event: "sweep_failed", message: err instanceof Error ? err.message : String(err) }));
    res.status(500).json({ ...summary, error: "sweep_failed" });
  }
}
