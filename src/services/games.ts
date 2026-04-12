import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDocs,
  runTransaction,
  query,
  where,
  limit,
  orderBy,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  arrayUnion,
  type Unsubscribe,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { parseFirebaseError } from "../utils/helpers";
import { analytics } from "./analytics";
import { logger, metrics } from "./logger";
import { captureException } from "../lib/sentry";
import { writeNotification } from "./notifications";

/* ────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────── */

export type GameStatus = "active" | "complete" | "forfeit";
/**
 * Game phases:
 *  - setting: setter chooses and records a trick
 *  - matching: matcher attempts, or (if judge active) optionally "calls BS"
 *  - setReview: judge reviews a "Call BS" on the set trick (only with active judge)
 *  - disputable: judge reviews matcher's "landed" claim (only with active judge)
 *
 * The honor-system path (no judge) never enters setReview or disputable.
 */
export type GamePhase = "setting" | "matching" | "setReview" | "disputable";

/** Judge nomination acceptance state. `null` means no judge was ever nominated. */
export type JudgeStatus = "pending" | "accepted" | "declined" | null;

/** A snapshot of a completed turn, stored in the game's turnHistory array. */
export interface TurnRecord {
  turnNumber: number;
  trickName: string;
  setterUid: string;
  setterUsername: string;
  matcherUid: string;
  matcherUsername: string;
  setVideoUrl: string | null;
  matchVideoUrl: string | null;
  landed: boolean;
  /** UID of the player who received a letter, or null if the trick was landed. */
  letterTo: string | null;
  /** UID of the judge who ruled on this turn, or null if no judge was involved. */
  judgedBy?: string | null;
}

/** Create a Firestore Timestamp from epoch milliseconds. Keeps Firebase SDK out of utils/. */
export function timestampFromMillis(ms: number): Timestamp {
  return Timestamp.fromMillis(ms);
}

export interface GameDoc {
  id: string;
  player1Uid: string;
  player2Uid: string;
  player1Username: string;
  player2Username: string;
  p1Letters: number;
  p2Letters: number;
  status: GameStatus;
  /** UID of the player whose turn it is */
  currentTurn: string;
  phase: GamePhase;
  /** UID of the player currently setting a trick */
  currentSetter: string;
  currentTrickName: string | null;
  currentTrickVideoUrl: string | null;
  matchVideoUrl: string | null;
  turnDeadline: Timestamp;
  turnNumber: number;
  winner: string | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  /** Accumulated history of completed turns (for clips replay). */
  turnHistory?: TurnRecord[];
  /** Denormalized verified-pro status for each player (set at game creation). */
  player1IsVerifiedPro?: boolean;
  player2IsVerifiedPro?: boolean;
  /** Optional associated spot for location context. Set at game creation, immutable. */
  spotId?: string | null;
  /**
   * UID of the nominated judge, or null for honor-system games.
   * Honor system: no disputable phase, no "Call BS" option.
   * With judge: dispute/BS flows route to the judge instead of the setter.
   */
  judgeId?: string | null;
  /** Denormalized judge username (for UI), null when no judge nominated. */
  judgeUsername?: string | null;
  /**
   * Judge invite state. null = no judge was ever nominated (pure honor system).
   * pending  → judge hasn't responded yet (game still operates honor-system)
   * accepted → judge is active; dispute/BS routes to them
   * declined → judge said no or 24h window expired (permanent honor system)
   */
  judgeStatus?: JudgeStatus;
  /**
   * UID of the player whose attempt/video is currently under review by the judge.
   * Set when phase transitions to setReview (matcher called BS) or disputable
   * (matcher claimed landed). Null otherwise.
   */
  judgeReviewFor?: string | null;
}

const TURN_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Parse a Firestore document snapshot into a typed GameDoc. */
function toGameDoc(snap: { id: string; data: () => Record<string, unknown> }): GameDoc {
  const raw = snap.data();
  // Validate required fields exist to prevent undefined-as-typed runtime errors
  if (typeof raw.player1Uid !== "string" || typeof raw.player2Uid !== "string" || typeof raw.status !== "string") {
    throw new Error(`Malformed game document: ${snap.id}`);
  }
  return { id: snap.id, ...raw } as GameDoc;
}

function getOpponent(game: GameDoc, playerUid: string): string {
  return playerUid === game.player1Uid ? game.player2Uid : game.player1Uid;
}

/**
 * True when a judge is nominated AND has accepted the invite.
 * Pending/declined/null judges do NOT activate dispute flows — the game
 * proceeds on the honor system until the judge positively accepts.
 */
export function isJudgeActive(game: Pick<GameDoc, "judgeId" | "judgeStatus">): boolean {
  return !!game.judgeId && game.judgeStatus === "accepted";
}

function gamesRef() {
  return collection(requireDb(), "games");
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

function checkTurnActionRate(gameId: string): void {
  const last = lastTurnActionAt.get(gameId) ?? 0;
  if (Date.now() - last < TURN_ACTION_COOLDOWN_MS) {
    throw new Error("Please wait before submitting another action");
  }
}

function recordTurnAction(gameId: string): void {
  lastTurnActionAt.set(gameId, Date.now());
  // Prevent unbounded growth: prune entries older than 60s
  if (lastTurnActionAt.size > 50) {
    const cutoff = Date.now() - 60_000;
    for (const [id, ts] of lastTurnActionAt) {
      if (ts < cutoff) lastTurnActionAt.delete(id);
    }
  }
}

/** @internal Reset rate-limit state (for tests only) */
export function _resetCreateGameRateLimit() {
  lastGameCreatedAt = 0;
  lastTurnActionAt.clear();
}

/* ────────────────────────────────────────────
 * Create a new game (challenge)
 * ──────────────────────────────────────────── */

/**
 * Canonical UUID shape. Matches the API's `UUID_REGEX` in
 * apps/api/src/routes/spots.ts. Malformed values are silently dropped at the
 * service boundary — callers that need to surface "your spot id is bad" UI
 * should validate upstream (e.g. `ChallengeScreen` does via `UUID_SHAPE`).
 */
const SPOT_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeSpotId(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  return SPOT_ID_SHAPE.test(raw) ? raw : null;
}

export interface CreateGameOptions {
  challengerIsVerifiedPro?: boolean;
  opponentIsVerifiedPro?: boolean;
  spotId?: string | null;
  /** Optional judge UID — must be different from both players. */
  judgeUid?: string | null;
  /** Denormalized judge username (for UI). Required when judgeUid is set. */
  judgeUsername?: string | null;
}

export async function createGame(
  challengerUid: string,
  challengerUsername: string,
  opponentUid: string,
  opponentUsername: string,
  options: CreateGameOptions = {},
): Promise<string> {
  if (Date.now() - lastGameCreatedAt < GAME_CREATE_COOLDOWN_MS) {
    throw new Error("Please wait before creating another game");
  }

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

  const docRef = await withRetry(() => addDoc(gamesRef(), gameData));
  lastGameCreatedAt = Date.now();
  metrics.gameCreated(docRef.id, challengerUid);
  // Update rate-limit timestamp on user profile (best effort — game is already created).
  setDoc(doc(requireDb(), "users", challengerUid), { lastGameCreatedAt: serverTimestamp() }, { merge: true }).catch(
    (err) => {
      logger.warn("rate_limit_timestamp_write_failed", {
        uid: challengerUid,
        error: parseFirebaseError(err),
      });
    },
  );
  // Notify opponent about the new challenge (best-effort)
  writeNotification({
    senderUid: challengerUid,
    recipientUid: opponentUid,
    type: "new_challenge",
    title: "New Challenge!",
    body: `@${challengerUsername} challenged you to S.K.A.T.E.`,
    gameId: docRef.id,
  });
  // Notify the judge (if any) that they've been nominated (best-effort)
  if (hasValidJudge) {
    writeNotification({
      senderUid: challengerUid,
      recipientUid: judgeUid,
      type: "judge_invite",
      title: "You've been asked to judge",
      body: `@${challengerUsername} vs @${opponentUsername} — accept to rule on disputes`,
      gameId: docRef.id,
    });
  }
  return docRef.id;
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

export async function acceptJudgeInvite(gameId: string): Promise<void> {
  const gameRef = doc(requireDb(), "games", gameId);
  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");
    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (!game.judgeId) throw new Error("No judge was nominated for this game");
    if (game.judgeStatus !== "pending") throw new Error("Judge invite is no longer pending");

    tx.update(gameRef, {
      judgeStatus: "accepted",
      updatedAt: serverTimestamp(),
    });
  });
}

export async function declineJudgeInvite(gameId: string): Promise<void> {
  const gameRef = doc(requireDb(), "games", gameId);
  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");
    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (!game.judgeId) throw new Error("No judge was nominated for this game");
    if (game.judgeStatus !== "pending") throw new Error("Judge invite is no longer pending");

    tx.update(gameRef, {
      judgeStatus: "declined",
      updatedAt: serverTimestamp(),
    });
  });
}

/* ────────────────────────────────────────────
 * Set a trick (setter's turn)
 * ──────────────────────────────────────────── */

export async function setTrick(gameId: string, trickName: string, videoUrl: string | null): Promise<void> {
  // Sanitise at the service boundary: trim whitespace, strip control chars, cap length
  const safeTrickName = trickName
    .trim()
    // eslint-disable-next-line no-control-regex -- intentionally stripping C0/C1 control characters
    .replace(/[\x00-\x1F\x7F]/g, "")
    .slice(0, 100);
  if (!safeTrickName) throw new Error("Trick name cannot be empty");

  checkTurnActionRate(gameId);
  const gameRef = doc(requireDb(), "games", gameId);

  // Firestore transactions have built-in retry for transient conflicts;
  // withRetry is not needed here and would incorrectly retry app-logic errors.
  const txResult = await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");

    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (game.phase !== "setting") throw new Error("Not in setting phase");

    const matcherUid = getOpponent(game, game.currentSetter);
    const setterUsername = game.currentSetter === game.player1Uid ? game.player1Username : game.player2Username;

    tx.update(gameRef, {
      phase: "matching",
      currentTrickName: safeTrickName,
      currentTrickVideoUrl: videoUrl,
      matchVideoUrl: null,
      currentTurn: matcherUid,
      turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
      updatedAt: serverTimestamp(),
    });

    return { setterUid: game.currentSetter, matcherUid, setterUsername };
  });
  recordTurnAction(gameId);
  metrics.trickSet(gameId, safeTrickName, videoUrl !== null);
  analytics.trickSet(gameId, safeTrickName);
  // Notify matcher it's their turn (best-effort)
  writeNotification({
    senderUid: txResult.setterUid,
    recipientUid: txResult.matcherUid,
    type: "your_turn",
    title: "Your Turn!",
    body: `Match @${txResult.setterUsername}'s ${safeTrickName}`,
    gameId,
  });
}

/* ────────────────────────────────────────────
 * Setter failed to land their trick — turn passes
 * ──────────────────────────────────────────── */

export async function failSetTrick(gameId: string): Promise<void> {
  checkTurnActionRate(gameId);
  const gameRef = doc(requireDb(), "games", gameId);

  const txResult = await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");

    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (game.phase !== "setting") throw new Error("Not in setting phase");

    const nextSetter = getOpponent(game, game.currentSetter);
    const prevSetterUsername = game.currentSetter === game.player1Uid ? game.player1Username : game.player2Username;

    tx.update(gameRef, {
      phase: "setting",
      currentSetter: nextSetter,
      currentTurn: nextSetter,
      currentTrickName: null,
      currentTrickVideoUrl: null,
      matchVideoUrl: null,
      turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
      turnNumber: game.turnNumber + 1,
      updatedAt: serverTimestamp(),
    });

    return { prevSetterUid: game.currentSetter, nextSetterUid: nextSetter, prevSetterUsername };
  });
  recordTurnAction(gameId);
  // Notify next setter it's their turn (best-effort)
  writeNotification({
    senderUid: txResult.prevSetterUid,
    recipientUid: txResult.nextSetterUid,
    type: "your_turn",
    title: "Your Turn to Set!",
    body: `@${txResult.prevSetterUsername} couldn't land their trick. Set a trick!`,
    gameId,
  });
}

/* ────────────────────────────────────────────
 * Submit match attempt (matcher self-judges)
 *
 * Honor system (no active judge):
 *   • landed  → matcher's call stands, roles swap, turn advances
 *   • missed  → matcher gains a letter, setter keeps setting
 *
 * With active judge:
 *   • landed  → "disputable" phase; judge has 24h to rule (auto-accept after)
 *   • missed  → letter applied immediately (matcher admitting a miss is never
 *               disputed — they lose by calling themselves out)
 * ──────────────────────────────────────────── */

export async function submitMatchAttempt(
  gameId: string,
  matchVideoUrl: string | null,
  landed: boolean,
): Promise<{ gameOver: boolean; winner: string | null }> {
  checkTurnActionRate(gameId);
  const gameRef = doc(requireDb(), "games", gameId);

  const result = await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");

    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (game.phase !== "matching") throw new Error("Not in matching phase");

    const matcherUid = getOpponent(game, game.currentSetter);
    const setterUsername = game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username;
    const matcherUsernameVal = game.player1Uid === game.currentSetter ? game.player2Username : game.player1Username;
    const judgeActive = isJudgeActive(game);

    // ── Matcher claims LANDED ─────────────────────────────────
    if (landed) {
      // With an active judge → route to disputable for judge review
      if (judgeActive && game.judgeId) {
        tx.update(gameRef, {
          phase: "disputable",
          matchVideoUrl,
          currentTurn: game.judgeId, // judge reviews, never the setter
          judgeReviewFor: matcherUid,
          turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
          updatedAt: serverTimestamp(),
        });

        return {
          outcome: "disputable" as const,
          gameOver: false,
          winner: null,
          setterUid: game.currentSetter,
          matcherUid,
          setterUsername,
          matcherUsername: matcherUsernameVal,
          judgeUid: game.judgeId,
          nextSetter: game.currentSetter,
          turnNumber: game.turnNumber,
        };
      }

      // Honor system → matcher's call stands immediately, roles swap.
      const nextSetter = matcherUid;
      const turnRecord: TurnRecord = {
        turnNumber: game.turnNumber,
        trickName: game.currentTrickName || "Trick",
        setterUid: game.currentSetter,
        setterUsername,
        matcherUid,
        matcherUsername: matcherUsernameVal,
        setVideoUrl: game.currentTrickVideoUrl,
        matchVideoUrl,
        landed: true,
        letterTo: null,
        judgedBy: null,
      };

      tx.update(gameRef, {
        matchVideoUrl,
        phase: "setting",
        currentSetter: nextSetter,
        currentTurn: nextSetter,
        turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
        turnNumber: game.turnNumber + 1,
        turnHistory: arrayUnion(turnRecord),
        p1Letters: game.p1Letters,
        p2Letters: game.p2Letters,
        updatedAt: serverTimestamp(),
      });

      return {
        outcome: "landed_honor" as const,
        gameOver: false,
        winner: null,
        setterUid: game.currentSetter,
        matcherUid,
        setterUsername,
        matcherUsername: matcherUsernameVal,
        nextSetter,
        turnNumber: game.turnNumber,
      };
    }

    // ── Matcher admits MISSED → immediate resolution (both paths) ──
    const isP1Matcher = matcherUid === game.player1Uid;
    let newP1Letters = game.p1Letters;
    let newP2Letters = game.p2Letters;

    if (isP1Matcher) newP1Letters++;
    else newP2Letters++;

    const gameOver = newP1Letters >= 5 || newP2Letters >= 5;
    const winner = gameOver ? (newP1Letters >= 5 ? game.player2Uid : game.player1Uid) : null;
    const nextSetter = game.currentSetter;

    const turnRecord: TurnRecord = {
      turnNumber: game.turnNumber,
      trickName: game.currentTrickName || "Trick",
      setterUid: game.currentSetter,
      setterUsername,
      matcherUid,
      matcherUsername: matcherUsernameVal,
      setVideoUrl: game.currentTrickVideoUrl,
      matchVideoUrl,
      landed: false,
      letterTo: matcherUid,
      judgedBy: null,
    };

    const updates: Record<string, unknown> = {
      matchVideoUrl,
      turnHistory: arrayUnion(turnRecord),
      p1Letters: newP1Letters,
      p2Letters: newP2Letters,
      updatedAt: serverTimestamp(),
    };

    if (gameOver) {
      updates.status = "complete";
      updates.winner = winner;
    } else {
      updates.phase = "setting";
      updates.currentSetter = nextSetter;
      updates.currentTurn = nextSetter;
      updates.turnDeadline = Timestamp.fromMillis(Date.now() + TURN_DURATION_MS);
      updates.turnNumber = game.turnNumber + 1;
    }

    tx.update(gameRef, updates);
    return {
      outcome: "missed" as const,
      gameOver,
      winner,
      setterUid: game.currentSetter,
      matcherUid,
      setterUsername,
      matcherUsername: matcherUsernameVal,
      nextSetter,
      turnNumber: game.turnNumber,
    };
  });
  recordTurnAction(gameId);
  metrics.matchSubmitted(gameId, landed);
  analytics.matchSubmitted(gameId, landed);

  // Disputable routed to the judge — notify the judge, not the setter.
  if (result.outcome === "disputable" && result.judgeUid) {
    writeNotification({
      senderUid: result.matcherUid,
      recipientUid: result.judgeUid,
      type: "your_turn",
      title: "Ruling Needed",
      body: `@${result.matcherUsername} claims they landed @${result.setterUsername}'s trick. Rule landed or missed?`,
      gameId,
    });
    return { gameOver: false, winner: null };
  }

  // Honor-system landed: matcher becomes next setter.
  if (result.outcome === "landed_honor") {
    writeNotification({
      senderUid: result.matcherUid,
      recipientUid: result.setterUid,
      type: "your_turn",
      title: "Trick Landed!",
      body: `@${result.matcherUsername} landed your trick. Your turn to match.`,
      gameId,
    });
    return { gameOver: false, winner: null };
  }

  // Missed path — game may be over here.
  if (result.gameOver && result.winner) {
    metrics.gameCompleted(gameId, result.winner, result.turnNumber);
    analytics.gameCompleted(gameId, result.winner === result.matcherUid);
  }

  // Send notifications based on outcome (best-effort)
  // In the missed path, only the matcher gains a letter, so the setter always
  // wins when the game ends here.
  if (result.gameOver) {
    writeNotification({
      senderUid: result.matcherUid,
      recipientUid: result.setterUid,
      type: "game_won",
      title: "You Won!",
      body: `vs @${result.matcherUsername}`,
      gameId,
    });
  } else {
    writeNotification({
      senderUid: result.matcherUid,
      recipientUid: result.nextSetter,
      type: "your_turn",
      title: "Your Turn to Set!",
      body: `Set a trick for @${result.matcherUsername}`,
      gameId,
    });
  }

  return { gameOver: result.gameOver, winner: result.winner };
}

/* ────────────────────────────────────────────
 * Matcher calls BS on the setter's trick (judge-only feature)
 *
 * Requires:
 *   • game in `matching` phase
 *   • caller is the matcher
 *   • judge is active (accepted)
 *
 * Effect: phase → setReview, currentTurn routes to judge. Judge rules
 * clean (set stands, matcher must attempt) or sketchy (setter re-sets).
 * 24h timeout → clean (benefit of the doubt to setter).
 * ──────────────────────────────────────────── */

export async function callBSOnSetTrick(gameId: string): Promise<void> {
  checkTurnActionRate(gameId);
  const gameRef = doc(requireDb(), "games", gameId);

  const result = await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");

    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (game.phase !== "matching") throw new Error("Not in matching phase");
    if (!isJudgeActive(game) || !game.judgeId) {
      throw new Error("Call BS is only available when a judge is active");
    }

    const matcherUid = getOpponent(game, game.currentSetter);
    const setterUsername = game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username;
    const matcherUsernameVal = game.player1Uid === game.currentSetter ? game.player2Username : game.player1Username;

    tx.update(gameRef, {
      phase: "setReview",
      currentTurn: game.judgeId, // judge rules on the set trick
      judgeReviewFor: game.currentSetter,
      turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
      updatedAt: serverTimestamp(),
    });

    return {
      judgeUid: game.judgeId,
      matcherUid,
      setterUsername,
      matcherUsername: matcherUsernameVal,
    };
  });
  recordTurnAction(gameId);

  writeNotification({
    senderUid: result.matcherUid,
    recipientUid: result.judgeUid,
    type: "your_turn",
    title: "Ruling Needed",
    body: `@${result.matcherUsername} called BS on @${result.setterUsername}'s set. Rule clean or sketchy?`,
    gameId,
  });
}

/* ────────────────────────────────────────────
 * Judge rules on a "Call BS" in the setReview phase.
 *
 *   clean=true   → set stands, matcher must attempt (phase=matching)
 *   clean=false  → setter re-sets (phase=setting, same setter, cleared trick)
 * ──────────────────────────────────────────── */

export async function judgeRuleSetTrick(gameId: string, clean: boolean): Promise<void> {
  checkTurnActionRate(gameId);
  const gameRef = doc(requireDb(), "games", gameId);

  const result = await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");

    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (game.phase !== "setReview") throw new Error("Not in setReview phase");
    if (!game.judgeId) throw new Error("No judge on this game");

    const matcherUid = getOpponent(game, game.currentSetter);
    const setterUsername = game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username;
    const matcherUsernameVal = game.player1Uid === game.currentSetter ? game.player2Username : game.player1Username;

    if (clean) {
      // Set stands — matcher has to attempt. Return to matching phase.
      tx.update(gameRef, {
        phase: "matching",
        currentTurn: matcherUid,
        judgeReviewFor: null,
        turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
        updatedAt: serverTimestamp(),
      });
    } else {
      // Setter must re-set. Clear the trick fields and stay on the same setter.
      tx.update(gameRef, {
        phase: "setting",
        currentTurn: game.currentSetter,
        currentTrickName: null,
        currentTrickVideoUrl: null,
        matchVideoUrl: null,
        judgeReviewFor: null,
        turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
        updatedAt: serverTimestamp(),
      });
    }

    return {
      clean,
      setterUid: game.currentSetter,
      matcherUid,
      setterUsername,
      matcherUsername: matcherUsernameVal,
    };
  });
  recordTurnAction(gameId);

  if (result.clean) {
    // Matcher must now attempt the (judged-clean) trick.
    writeNotification({
      senderUid: result.setterUid,
      recipientUid: result.matcherUid,
      type: "your_turn",
      title: "Judge ruled: Clean",
      body: `The set stands. Match @${result.setterUsername}'s trick.`,
      gameId,
    });
  } else {
    // Setter has to re-set.
    writeNotification({
      senderUid: result.matcherUid,
      recipientUid: result.setterUid,
      type: "your_turn",
      title: "Judge ruled: Sketchy",
      body: `Set a new trick for @${result.matcherUsername}.`,
      gameId,
    });
  }
}

/* ────────────────────────────────────────────
 * Resolve a disputable turn (judge rules on matcher's "landed" claim)
 *
 * Only the judge can call this. The setter never self-judges — disputes
 * only exist in games with an active judge.
 *
 *   accept=true  → matcher's "landed" call stands, roles swap
 *   accept=false → judge overrules, matcher gets a letter
 * ──────────────────────────────────────────── */

export async function resolveDispute(
  gameId: string,
  accept: boolean,
): Promise<{ gameOver: boolean; winner: string | null }> {
  checkTurnActionRate(gameId);
  const gameRef = doc(requireDb(), "games", gameId);

  const result = await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");

    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (game.phase !== "disputable") throw new Error("Not in disputable phase");
    if (!game.judgeId) throw new Error("No judge on this game");

    const matcherUid = getOpponent(game, game.currentSetter);
    const setterUsername = game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username;
    const matcherUsernameVal = game.player1Uid === game.currentSetter ? game.player2Username : game.player1Username;

    const isP1Matcher = matcherUid === game.player1Uid;
    let newP1Letters = game.p1Letters;
    let newP2Letters = game.p2Letters;

    const landed = accept; // accept = matcher landed; dispute = matcher missed

    if (!landed) {
      if (isP1Matcher) newP1Letters++;
      else newP2Letters++;
    }

    const gameOver = newP1Letters >= 5 || newP2Letters >= 5;
    const winner = gameOver ? (newP1Letters >= 5 ? game.player2Uid : game.player1Uid) : null;
    const nextSetter = landed ? matcherUid : game.currentSetter;

    const turnRecord: TurnRecord = {
      turnNumber: game.turnNumber,
      trickName: game.currentTrickName || "Trick",
      setterUid: game.currentSetter,
      setterUsername,
      matcherUid,
      matcherUsername: matcherUsernameVal,
      setVideoUrl: game.currentTrickVideoUrl,
      matchVideoUrl: game.matchVideoUrl,
      landed,
      letterTo: landed ? null : matcherUid,
      judgedBy: game.judgeId,
    };

    const updates: Record<string, unknown> = {
      turnHistory: arrayUnion(turnRecord),
      p1Letters: newP1Letters,
      p2Letters: newP2Letters,
      judgeReviewFor: null,
      updatedAt: serverTimestamp(),
    };

    if (gameOver) {
      updates.status = "complete";
      updates.winner = winner;
    } else {
      updates.phase = "setting";
      updates.currentSetter = nextSetter;
      updates.currentTurn = nextSetter;
      updates.turnDeadline = Timestamp.fromMillis(Date.now() + TURN_DURATION_MS);
      updates.turnNumber = game.turnNumber + 1;
    }

    tx.update(gameRef, updates);
    return {
      gameOver,
      winner,
      landed,
      judgeUid: game.judgeId,
      setterUid: game.currentSetter,
      matcherUid,
      setterUsername,
      matcherUsername: matcherUsernameVal,
      nextSetter,
      turnNumber: game.turnNumber,
    };
  });
  recordTurnAction(gameId);

  if (result.gameOver && result.winner) {
    metrics.gameCompleted(gameId, result.winner, result.turnNumber);
    analytics.gameCompleted(gameId, result.winner === result.matcherUid);
  }

  // Notifications (best-effort) — sender is the judge, not a player.
  // In dispute resolution, only the matcher can gain a letter, so the setter
  // is always the winner when the game ends.
  if (result.gameOver) {
    writeNotification({
      senderUid: result.judgeUid,
      recipientUid: result.matcherUid,
      type: "game_lost",
      title: "Game Over",
      body: `vs @${result.setterUsername}`,
      gameId,
    });
  } else if (result.landed) {
    writeNotification({
      senderUid: result.judgeUid,
      recipientUid: result.matcherUid,
      type: "your_turn",
      title: "Judge ruled: Landed",
      body: `You landed! Set a trick for @${result.setterUsername}`,
      gameId,
    });
  } else {
    writeNotification({
      senderUid: result.judgeUid,
      recipientUid: result.matcherUid,
      type: "your_turn",
      title: "Judge ruled: Missed",
      body: `Set a trick for @${result.matcherUsername}`,
      gameId,
    });
  }

  return { gameOver: result.gameOver, winner: result.winner };
}

/* ────────────────────────────────────────────
 * Forfeit expired turn
 * ──────────────────────────────────────────── */

export async function forfeitExpiredTurn(gameId: string): Promise<{
  forfeited: boolean;
  winner: string | null;
  disputeAutoAccepted?: boolean;
  /** True when an expired setReview was auto-ruled clean (set stands). */
  setReviewAutoCleared?: boolean;
}> {
  const gameRef = doc(requireDb(), "games", gameId);

  return runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) return { forfeited: false, winner: null };

    const game = toGameDoc(snap);
    if (game.status !== "active") return { forfeited: false, winner: null };

    const deadline = game.turnDeadline?.toMillis?.() ?? 0;
    if (deadline === 0 || Date.now() < deadline) {
      return { forfeited: false, winner: null };
    }

    // ── Disputable phase expired → auto-accept matcher's "landed" call ──
    if (game.phase === "disputable") {
      const matcherUid = getOpponent(game, game.currentSetter);
      const setterUsername = game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username;
      const matcherUsernameVal = game.player1Uid === game.currentSetter ? game.player2Username : game.player1Username;

      // Roles swap: matcher (who landed) becomes next setter
      const nextSetter = matcherUid;

      const turnRecord: TurnRecord = {
        turnNumber: game.turnNumber,
        trickName: game.currentTrickName || "Trick",
        setterUid: game.currentSetter,
        setterUsername,
        matcherUid,
        matcherUsername: matcherUsernameVal,
        setVideoUrl: game.currentTrickVideoUrl,
        matchVideoUrl: game.matchVideoUrl,
        landed: true,
        letterTo: null,
        judgedBy: null, // auto-accept, no judge ruled explicitly
      };

      tx.update(gameRef, {
        phase: "setting",
        currentSetter: nextSetter,
        currentTurn: nextSetter,
        turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
        turnNumber: game.turnNumber + 1,
        turnHistory: arrayUnion(turnRecord),
        p1Letters: game.p1Letters,
        p2Letters: game.p2Letters,
        judgeReviewFor: null,
        updatedAt: serverTimestamp(),
      });

      return { forfeited: false, winner: null, disputeAutoAccepted: true };
    }

    // ── setReview phase expired → benefit of doubt to setter (set stands) ──
    if (game.phase === "setReview") {
      const matcherUid = getOpponent(game, game.currentSetter);
      tx.update(gameRef, {
        phase: "matching",
        currentTurn: matcherUid,
        judgeReviewFor: null,
        turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
        updatedAt: serverTimestamp(),
      });
      return { forfeited: false, winner: null, setReviewAutoCleared: true };
    }

    // ── Normal forfeit (setting / matching) ──────────────────
    const winner = getOpponent(game, game.currentTurn);

    tx.update(gameRef, {
      status: "forfeit",
      winner,
      updatedAt: serverTimestamp(),
    });

    metrics.gameForfeit(gameId, winner);
    return { forfeited: true, winner };
  });
}

/* ────────────────────────────────────────────
 * One-time queries
 * ──────────────────────────────────────────── */

/**
 * Fetch all completed/forfeit games for a player (one-time read).
 * Used for viewing another player's public profile without subscribing
 * to real-time updates. Returns games sorted by updatedAt descending.
 *
 * When `viewerUid` is provided, only returns games where BOTH players
 * are participants. This is required because Firestore security rules
 * only allow reading games you're a player in.
 */
export async function fetchPlayerCompletedGames(uid: string, viewerUid?: string): Promise<GameDoc[]> {
  const ref = gamesRef();
  const statusFilter = ["complete", "forfeit"];

  // When viewerUid is provided, scope queries to games between both players.
  // This satisfies Firestore rules that restrict game reads to participants.
  const sharedFilter = viewerUid && viewerUid !== uid;
  const q1Constraints = [
    where("player1Uid", "==", uid),
    ...(sharedFilter ? [where("player2Uid", "==", viewerUid)] : []),
    where("status", "in", statusFilter),
    orderBy("updatedAt", "desc"),
    limit(100),
  ];
  const q2Constraints = [
    where("player2Uid", "==", uid),
    ...(sharedFilter ? [where("player1Uid", "==", viewerUid)] : []),
    where("status", "in", statusFilter),
    orderBy("updatedAt", "desc"),
    limit(100),
  ];
  const q1 = query(ref, ...q1Constraints);
  const q2 = query(ref, ...q2Constraints);

  const [snap1, snap2] = await Promise.all([withRetry(() => getDocs(q1)), withRetry(() => getDocs(q2))]);

  const all = [...snap1.docs, ...snap2.docs].map((d) => toGameDoc(d));

  // Deduplicate (a player could theoretically be both p1 and p2 in edge cases)
  const seen = new Set<string>();
  const unique: GameDoc[] = [];
  for (const g of all) {
    if (!seen.has(g.id)) {
      seen.add(g.id);
      unique.push(g);
    }
  }

  // Sort by updatedAt descending
  return unique.sort((a, b) => {
    const aTs = a.updatedAt;
    const aTime = aTs && typeof aTs.toMillis === "function" ? aTs.toMillis() : 0;
    const bTs = b.updatedAt;
    const bTime = bTs && typeof bTs.toMillis === "function" ? bTs.toMillis() : 0;
    return bTime - aTime;
  });
}

/* ────────────────────────────────────────────
 * Real-time listeners
 * ──────────────────────────────────────────── */

/**
 * Subscribe to all games where the user is a player OR the nominated judge.
 * @param limitCount — max number of games per query (defaults to 20).
 * Returns unsubscribe function.
 */
export function subscribeToMyGames(
  uid: string,
  onUpdate: (games: GameDoc[]) => void,
  limitCount: number = 20,
): Unsubscribe {
  // Firestore doesn't support OR queries across different fields natively,
  // so we run three queries (player1, player2, judge) and merge.
  let p1Games: GameDoc[] = [];
  let p2Games: GameDoc[] = [];
  let judgeGames: GameDoc[] = [];

  const merge = () => {
    const all = [...p1Games, ...p2Games, ...judgeGames];
    // Deduplicate by id
    const map = new Map(all.map((g) => [g.id, g]));
    const sorted = Array.from(map.values()).sort((a, b) => {
      // Active first, then by turn number desc
      if (a.status === "active" && b.status !== "active") return -1;
      if (a.status !== "active" && b.status === "active") return 1;
      return b.turnNumber - a.turnNumber;
    });
    onUpdate(sorted);
  };

  const q1 = query(gamesRef(), where("player1Uid", "==", uid), limit(limitCount));
  const q2 = query(gamesRef(), where("player2Uid", "==", uid), limit(limitCount));
  const q3 = query(gamesRef(), where("judgeId", "==", uid), limit(limitCount));

  const handleError = (err: Error) => {
    logger.warn("game_subscription_error", { uid, error: err.message });
    captureException(err, { extra: { context: "subscribeToMyGames", uid } });
  };

  const unsub1 = onSnapshot(
    q1,
    (snap) => {
      p1Games = snap.docs.map((d) => toGameDoc(d));
      merge();
    },
    handleError,
  );

  const unsub2 = onSnapshot(
    q2,
    (snap) => {
      p2Games = snap.docs.map((d) => toGameDoc(d));
      merge();
    },
    handleError,
  );

  const unsub3 = onSnapshot(
    q3,
    (snap) => {
      judgeGames = snap.docs.map((d) => toGameDoc(d));
      merge();
    },
    handleError,
  );

  return () => {
    unsub1();
    unsub2();
    unsub3();
  };
}

/**
 * Subscribe to a single game for real-time updates
 */
export function subscribeToGame(gameId: string, onUpdate: (game: GameDoc | null) => void): Unsubscribe {
  return onSnapshot(
    doc(requireDb(), "games", gameId),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      onUpdate(toGameDoc(snap));
    },
    (err) => {
      logger.warn("game_subscription_error", { gameId, error: err.message });
      captureException(err, { extra: { context: "subscribeToGame", gameId } });
      onUpdate(null);
    },
  );
}
