import { collection, doc, runTransaction, serverTimestamp, Timestamp, arrayUnion } from "firebase/firestore";
import { requireDb } from "../firebase";
import { metrics } from "./logger";
import { writeLandedClipsInTransaction } from "./clips";
import { writeNotificationInTx } from "./notifications";
import { createPushDispatchOutbox, drainPushDispatchOutbox, resetPushDispatchOutbox } from "./pushDispatch";
import { toGameDoc, type GameDoc } from "./games.mappers";
import { TURN_DURATION_MS } from "./turnDuration";
import { decideExpiredForfeit, type ForfeitGameUpdate } from "./turnForfeit.shared";

export { TURN_DURATION_MS };

export function gamesRef() {
  return collection(requireDb(), "games");
}

export function getOpponent(game: GameDoc, playerUid: string): string {
  return playerUid === game.player1Uid ? game.player2Uid : game.player1Uid;
}

/* ────────────────────────────────────────────
 * Client-side rate limiting (defense-in-depth)
 * ──────────────────────────────────────────── */

// Game creation: one per 10 seconds globally
let lastGameCreatedAt = 0;
const GAME_CREATE_COOLDOWN_MS = 10_000;

// Turn actions (setTrick, failSetTrick, submitMatchAttempt): one per 3 seconds per game
const lastTurnActionAt = new Map<string, number>();
const TURN_ACTION_COOLDOWN_MS = 3_000;

export function checkGameCreationRate(): void {
  if (Date.now() - lastGameCreatedAt < GAME_CREATE_COOLDOWN_MS) {
    throw new Error("Please wait before creating another game");
  }
}

export function recordGameCreation(): void {
  lastGameCreatedAt = Date.now();
}

export function checkTurnActionRate(gameId: string): void {
  const last = lastTurnActionAt.get(gameId) ?? 0;
  if (Date.now() - last < TURN_ACTION_COOLDOWN_MS) {
    throw new Error("Please wait before submitting another action");
  }
}

export function recordTurnAction(gameId: string): void {
  const now = Date.now();
  lastTurnActionAt.set(gameId, now);
  // Drop entries past the cooldown window so the map stays bounded by
  // concurrently-active games, not an arbitrary size threshold.
  const cutoff = now - TURN_ACTION_COOLDOWN_MS;
  for (const [id, ts] of lastTurnActionAt) {
    if (ts < cutoff) lastTurnActionAt.delete(id);
  }
}

/** @internal Reset rate-limit state (for tests only) */
export function _resetCreateGameRateLimit() {
  lastGameCreatedAt = 0;
  lastTurnActionAt.clear();
}

/** @internal Inspect the turn-action rate-limit map size (for tests only) */
export function _turnActionMapSize(): number {
  return lastTurnActionAt.size;
}

/**
 * Advance the game when the current turn's deadline has passed.
 *
 * Safe to call speculatively: returns `{ forfeited: false }` when the game
 * is over, the deadline hasn't passed, or no turn is active. Any client
 * observing an expired turn should call this — Firestore rules ensure only
 * a legal transition is written.
 *
 * Expiration branches:
 *   • `setting` / `matching`  → active player forfeits (opponent wins)
 *   • `disputable`            → matcher's "landed" call auto-accepted
 *   • `setReview`             → setter's trick auto-ruled clean
 *
 * `callerUid` is the acting user's uid (the player whose tab triggered this
 * speculative resolve). It gates the "your turn" notification: the
 * disputable/setReview phases can be triggered by EITHER participant, so the
 * player advanced by the resolution is often the caller themselves. The
 * /notifications create rule forbids self-notify (senderUid == auth.uid AND
 * recipientUid != auth.uid), so emitting one would abort the whole transaction.
 * Pass `null` only from contexts with no signed-in user (none today).
 */
export async function forfeitExpiredTurn(
  gameId: string,
  callerUid: string | null,
): Promise<{
  forfeited: boolean;
  winner: string | null;
  disputeAutoAccepted?: boolean;
  /** True when an expired setReview was auto-ruled clean (set stands). */
  setReviewAutoCleared?: boolean;
}> {
  const gameRef = doc(requireDb(), "games", gameId);
  const pushOutbox = createPushDispatchOutbox();

  const result = await runTransaction(requireDb(), async (tx) => {
    // Reset on every tx body invocation so a retry doesn't accumulate
    // duplicate push dispatches.
    resetPushDispatchOutbox(pushOutbox);
    const snap = await tx.get(gameRef);
    if (!snap.exists()) return { forfeited: false, winner: null };

    const game = toGameDoc(snap);

    // Decision logic lives in the SDK-agnostic helper so the client and the
    // server "auto-referee" cron sweep can never diverge. Returns null when
    // the game is no longer active or the deadline hasn't passed.
    const decision = decideExpiredForfeit(game, Date.now(), gameId);
    if (!decision) return { forfeited: false, winner: null };

    // GAME-STATE write is identical regardless of who the caller is — this is
    // what keeps the client and the admin sweep byte-for-byte in parity.
    tx.update(gameRef, toWebGameUpdate(decision.gameUpdate));

    if (decision.landedClips) {
      // Auto-accept: matcher's landed call stands, so both set and match are
      // confirmed landed clips for the feed.
      writeLandedClipsInTransaction(tx, decision.landedClips);
    }

    // Emit the "your turn" notification ONLY when the advanced player is not
    // the caller. The disputable/setReview phases let EITHER participant —
    // player OR judge — trigger the resolve, so the recipient is frequently the
    // caller, and the /notifications create rule denies a self-notify
    // (recipientUid must differ from auth.uid), which would roll back this
    // entire transaction. Skipping is also correct on its own terms: a caller
    // who triggered the resolve is demonstrably in the app.
    //
    // CRITICAL: the notification's senderUid MUST be `callerUid` (the
    // authenticated writer), NOT the shared decision's canonical sender (the
    // currentSetter). The /notifications create rule requires
    // `senderUid == request.auth.uid`, so stamping the setter would DENY the
    // write — and abort this whole transaction — whenever the caller is not the
    // setter. That is exactly the JUDGE-as-caller case: disputable/setReview
    // have `currentTurn == judgeId`, and subscribeToMyGames (which includes
    // judge games) triggers the resolve from the judge's tab with
    // callerUid == judgeUid. With senderUid = callerUid, sender == auth.uid and
    // recipient (the matcher) != caller, so the create is rule-legal for BOTH
    // setter-caller and judge-caller; the matcher-self case is skipped by the
    // guard above (the matcher is present anyway). The game-state `tx.update`
    // above is UNCONDITIONAL and never depends on this side-effect, so the
    // server sweep (admin SDK, always notifies the away player) stays in parity.
    if (decision.notification && decision.notification.recipientUid !== callerUid) {
      writeNotificationInTx(
        tx,
        {
          // The authenticated user who triggered the resolve — satisfies the
          // /notifications create rule's `senderUid == request.auth.uid`. The
          // canonical sender from the shared decision (currentSetter) is the
          // null-caller fallback only; production always has a signed-in caller
          // (none pass null today), so that branch is never rule-evaluated.
          senderUid: callerUid ?? decision.notification.senderUid,
          recipientUid: decision.notification.recipientUid,
          type: decision.notification.type,
          title: decision.notification.title,
          body: decision.notification.body,
          gameId,
        },
        pushOutbox,
      );
    }

    if (decision.kind === "disputeAccept") {
      return { forfeited: false, winner: null, disputeAutoAccepted: true };
    }
    if (decision.kind === "setReviewClear") {
      return { forfeited: false, winner: null, setReviewAutoCleared: true };
    }

    // Terminal forfeit — winner is non-null by construction for this kind.
    const winner = decision.winnerUid as string;
    metrics.gameForfeit(gameId, winner);
    return { forfeited: true, winner };
  });

  // Fire any staged push AFTER the tx commits (never on retries/rollbacks).
  void drainPushDispatchOutbox(pushOutbox);
  return result;
}

/**
 * Translate the SDK-agnostic `ForfeitGameUpdate` into a Firebase web-SDK write
 * object: epoch-ms deadlines become `Timestamp`s, the optional turn record is
 * appended via `arrayUnion`, and `updatedAt` is always stamped server-side.
 *
 * @internal Exported for the parity test that proves the server's
 * `toAdminGameUpdate` produces the same logical write. Not consumed elsewhere.
 */
export function toWebGameUpdate(update: ForfeitGameUpdate): Record<string, unknown> {
  const out: Record<string, unknown> = { updatedAt: serverTimestamp() };
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
  if (update.appendTurnRecord !== undefined) out.turnHistory = arrayUnion(update.appendTurnRecord);
  return out;
}
