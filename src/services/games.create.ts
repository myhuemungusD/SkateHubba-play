import { doc, setDoc, runTransaction, serverTimestamp, Timestamp } from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { parseFirebaseError } from "../utils/helpers";
import { logger, metrics } from "./logger";
import { writeNotification } from "./notifications";
import {
  toGameDoc,
  normalizeSpotId,
  type GameStatus,
  type GamePhase,
  type JudgeStatus,
  type CreateGameOptions,
} from "./games.mappers";
import { TURN_DURATION_MS, gamesRef, checkGameCreationRate, recordGameCreation } from "./games.turns";

/* ────────────────────────────────────────────
 * Create a new game (challenge)
 * ──────────────────────────────────────────── */

/**
 * Create a new SKATE game between two players. Returns the new game ID.
 *
 * Preconditions / throws:
 *   • caller must be `challengerUid` (enforced by Firestore rules)
 *   • challenger email must be verified (rules)
 *   • rate limited: one game per `GAME_CREATE_COOLDOWN_MS` per client
 *   • if `judgeUid` is supplied, `judgeUsername` MUST also be supplied and
 *     `judgeUid` MUST differ from both players
 *
 * The challenger is assigned as `player1` and sets first.
 */
export async function createGame(
  challengerUid: string,
  challengerUsername: string,
  opponentUid: string,
  opponentUsername: string,
  options: CreateGameOptions = {},
): Promise<string> {
  checkGameCreationRate();

  const { challengerIsVerifiedPro, opponentIsVerifiedPro, spotId, judgeUid, judgeUsername } = options;

  // Defense-in-depth: drop any spotId that doesn't look like a UUID before
  // it reaches Firestore. Keeps the data model clean even if an upstream
  // caller forgets to validate or a shared URL has a stale/garbled value.
  const safeSpotId = normalizeSpotId(spotId);

  // Judge validation: if a judge is nominated, they must be a distinct third
  // party. Silently dropping an invalid nomination lets the game fall back to
  // honor system rather than rejecting the whole creation — UI-level guards
  // surface the "can't judge yourself / your opponent" message upstream.
  const hasValidJudge =
    typeof judgeUid === "string" &&
    judgeUid.length > 0 &&
    judgeUid !== challengerUid &&
    judgeUid !== opponentUid &&
    typeof judgeUsername === "string" &&
    judgeUsername.length > 0;

  const deadline = Timestamp.fromMillis(Date.now() + TURN_DURATION_MS);

  const gameData = {
    player1Uid: challengerUid,
    player2Uid: opponentUid,
    player1Username: challengerUsername,
    player2Username: opponentUsername,
    p1Letters: 0,
    p2Letters: 0,
    status: "active" as GameStatus,
    // Challenger sets first trick
    currentTurn: challengerUid,
    phase: "setting" as GamePhase,
    currentSetter: challengerUid,
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnDeadline: deadline,
    turnNumber: 1,
    winner: null,
    turnHistory: [],
    // Judge fields default to null (honor system). Keeping explicit nulls —
    // rather than omitting — makes security rule checks easier and keeps
    // the schema uniform across all game docs.
    judgeId: hasValidJudge ? judgeUid : null,
    judgeUsername: hasValidJudge ? judgeUsername : null,
    judgeStatus: (hasValidJudge ? "pending" : null) as JudgeStatus,
    judgeReviewFor: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...(challengerIsVerifiedPro && { player1IsVerifiedPro: true }),
    ...(opponentIsVerifiedPro && { player2IsVerifiedPro: true }),
    ...(safeSpotId && { spotId: safeSpotId }),
  };

  // Generate the game ID client-side so a retry after a perceived network
  // failure re-sends the exact same write (idempotent at a fixed ID) instead
  // of creating a second game. addDoc would be non-deterministic here.
  const newGameId = doc(gamesRef()).id;
  await withRetry(() => setDoc(doc(gamesRef(), newGameId), gameData));
  recordGameCreation();
  metrics.gameCreated(newGameId, challengerUid);
  // Update rate-limit timestamp on user profile (best effort — game is already created).
  // PR-A1: also reset `tricksLandedThisGame` so the per-game anti-grinding cap
  // (plan §3.1.3) starts fresh. Same write piggy-backs the existing
  // `lastGameCreatedAt` merge — one round-trip instead of two.
  setDoc(
    doc(requireDb(), "users", challengerUid),
    { lastGameCreatedAt: serverTimestamp(), tricksLandedThisGame: 0 },
    { merge: true },
  ).catch((err) => {
    logger.warn("rate_limit_timestamp_write_failed", {
      uid: challengerUid,
      error: parseFirebaseError(err),
    });
  });
  // The opponent's `tricksLandedThisGame` reset is best-effort: existing
  // Firestore rules pin `users/{uid}` updates to the owning user, so this
  // write is denied at the rules layer in PR-A1. Keeping the call here makes
  // the intent explicit for PR-A2's rule loosening (game-create carve-out)
  // and falls back silently in the meantime.
  setDoc(doc(requireDb(), "users", opponentUid), { tricksLandedThisGame: 0 }, { merge: true }).catch((err) => {
    logger.warn("opponent_tricks_reset_write_failed", {
      uid: opponentUid,
      error: parseFirebaseError(err),
    });
  });
  // Notify opponent about the new challenge (best-effort). createGame is not
  // transactional, so this stays outside — the only perceivable race is a
  // missed toast if the tab dies in the narrow window between the two writes.
  writeNotification({
    senderUid: challengerUid,
    recipientUid: opponentUid,
    type: "new_challenge",
    title: "New Challenge!",
    body: `@${challengerUsername} challenged you to S.K.A.T.E.`,
    gameId: newGameId,
  });
  // Notify the referee (if any) that they've been nominated (best-effort).
  // The notification `type` code stays "judge_invite" for schema stability —
  // existing docs and any listeners keyed on it must keep working. Only the
  // user-visible title copy is renamed.
  if (hasValidJudge) {
    writeNotification({
      senderUid: challengerUid,
      recipientUid: judgeUid,
      type: "judge_invite",
      title: "You've been asked to referee",
      body: `@${challengerUsername} vs @${opponentUsername} — accept to rule on disputes`,
      gameId: newGameId,
    });
  }
  return newGameId;
}

/* ────────────────────────────────────────────
 * Judge invite lifecycle
 *
 * Judge nomination is OPTIONAL — a game can be played on the honor system
 * with no judge at all. When a judge is nominated, the invite stays in
 * `pending` until the judge accepts, declines, or the 24h window elapses.
 *
 * While pending: game operates as honor system (no dispute / no BS calls)
 * Accepted:      dispute & BS flows route to the judge
 * Declined:      permanent honor system (judgeId preserved for history,
 *                judgeStatus flipped so rules know not to route to them)
 * ──────────────────────────────────────────── */

/**
 * Accept a pending referee invite. Must be called by the nominated referee;
 * rejects if the game is over, has no referee, or the invite is no longer
 * pending (already accepted / declined / 24h expired).
 */
export async function acceptJudgeInvite(gameId: string): Promise<void> {
  const gameRef = doc(requireDb(), "games", gameId);
  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");
    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (!game.judgeId) throw new Error("No referee was nominated for this game");
    if (game.judgeStatus !== "pending") throw new Error("Referee invite is no longer pending");

    tx.update(gameRef, {
      judgeStatus: "accepted",
      updatedAt: serverTimestamp(),
    });
  });
}

/**
 * Decline a pending referee invite. The game continues on the honor system;
 * `judgeId` is preserved for history but `judgeStatus` flips to `declined`
 * so BS / dispute flows route back to honor-system behavior.
 */
export async function declineJudgeInvite(gameId: string): Promise<void> {
  const gameRef = doc(requireDb(), "games", gameId);
  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");
    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (!game.judgeId) throw new Error("No referee was nominated for this game");
    if (game.judgeStatus !== "pending") throw new Error("Referee invite is no longer pending");

    tx.update(gameRef, {
      judgeStatus: "declined",
      updatedAt: serverTimestamp(),
    });
  });
}
