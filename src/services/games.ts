import {
  collection,
  doc,
  addDoc,
  setDoc,
  runTransaction,
  query,
  where,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  arrayUnion,
  type Unsubscribe,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { logger, metrics } from "./logger";
import { captureException } from "../lib/sentry";
import { writeNotification } from "./notifications";

/* ────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────── */

export type GameStatus = "active" | "complete" | "forfeit";
export type GamePhase = "setting" | "matching";

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

export async function createGame(
  challengerUid: string,
  challengerUsername: string,
  opponentUid: string,
  opponentUsername: string,
): Promise<string> {
  if (Date.now() - lastGameCreatedAt < GAME_CREATE_COOLDOWN_MS) {
    throw new Error("Please wait before creating another game");
  }

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
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const docRef = await withRetry(() => addDoc(gamesRef(), gameData));
  lastGameCreatedAt = Date.now();
  metrics.gameCreated(docRef.id, challengerUid);
  // Update rate-limit timestamp on user profile (best effort — game is already created).
  setDoc(doc(requireDb(), "users", challengerUid), { lastGameCreatedAt: serverTimestamp() }, { merge: true }).catch(
    () => {},
  );
  // Notify opponent about the new challenge (best-effort)
  writeNotification({
    recipientUid: opponentUid,
    type: "new_challenge",
    title: "New Challenge!",
    body: `@${challengerUsername} challenged you to S.K.A.T.E.`,
    gameId: docRef.id,
  });
  return docRef.id;
}

/* ────────────────────────────────────────────
 * Set a trick (setter's turn)
 * ──────────────────────────────────────────── */

export async function setTrick(gameId: string, trickName: string, videoUrl: string | null): Promise<void> {
  // Sanitise at the service boundary: trim whitespace, cap length
  const safeTrickName = trickName.trim().slice(0, 100);
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

    return { matcherUid, setterUsername };
  });
  recordTurnAction(gameId);
  // Notify matcher it's their turn (best-effort)
  writeNotification({
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

    return { nextSetterUid: nextSetter, prevSetterUsername };
  });
  recordTurnAction(gameId);
  // Notify next setter it's their turn (best-effort)
  writeNotification({
    recipientUid: txResult.nextSetterUid,
    type: "your_turn",
    title: "Your Turn to Set!",
    body: `@${txResult.prevSetterUsername} couldn't land their trick. Set a trick!`,
    gameId,
  });
}

/* ────────────────────────────────────────────
 * Submit match attempt (matcher self-judges, resolves turn immediately)
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
    const isP1Matcher = matcherUid === game.player1Uid;
    let newP1Letters = game.p1Letters;
    let newP2Letters = game.p2Letters;

    if (!landed) {
      if (isP1Matcher) newP1Letters++;
      else newP2Letters++;
    }

    const gameOver = newP1Letters >= 5 || newP2Letters >= 5;
    const winner = gameOver ? (newP1Letters >= 5 ? game.player2Uid : game.player1Uid) : null;
    const nextSetter = landed ? matcherUid : game.currentSetter;

    // Record this turn in the history for clips replay
    const setterUsername = game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username;
    const matcherUsernameVal = game.player1Uid === game.currentSetter ? game.player2Username : game.player1Username;

    const turnRecord: TurnRecord = {
      turnNumber: game.turnNumber,
      trickName: game.currentTrickName || "Trick",
      setterUid: game.currentSetter,
      setterUsername,
      matcherUid,
      matcherUsername: matcherUsernameVal,
      setVideoUrl: game.currentTrickVideoUrl,
      matchVideoUrl,
      landed,
      letterTo: landed ? null : matcherUid,
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
      gameOver,
      winner,
      setterUid: game.currentSetter,
      matcherUid,
      setterUsername,
      matcherUsername: matcherUsernameVal,
      nextSetter,
    };
  });
  recordTurnAction(gameId);

  // Send notifications based on outcome (best-effort)
  if (result.gameOver) {
    // Notify the setter that the game ended
    const setterWon = result.winner === result.setterUid;
    writeNotification({
      recipientUid: result.setterUid,
      type: setterWon ? "game_won" : "game_lost",
      title: setterWon ? "You Won!" : "Game Over",
      body: `vs @${result.matcherUsername}`,
      gameId,
    });
  } else {
    // Notify next setter it's their turn
    writeNotification({
      recipientUid: result.nextSetter,
      type: "your_turn",
      title: "Your Turn to Set!",
      body: `Set a trick for @${result.nextSetter === result.setterUid ? result.matcherUsername : result.setterUsername}`,
      gameId,
    });
  }

  return { gameOver: result.gameOver, winner: result.winner };
}

/* ────────────────────────────────────────────
 * Forfeit expired turn
 * ──────────────────────────────────────────── */

export async function forfeitExpiredTurn(gameId: string): Promise<{ forfeited: boolean; winner: string | null }> {
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

    // The player whose turn it is forfeits — opponent wins
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
 * Real-time listeners
 * ──────────────────────────────────────────── */

/**
 * Subscribe to all games where the user is a player.
 * @param limitCount — max number of games per query (defaults to 20).
 * Returns unsubscribe function.
 */
export function subscribeToMyGames(
  uid: string,
  onUpdate: (games: GameDoc[]) => void,
  limitCount: number = 20,
): Unsubscribe {
  // Firestore doesn't support OR queries across different fields natively,
  // so we run two queries and merge.
  let p1Games: GameDoc[] = [];
  let p2Games: GameDoc[] = [];

  const merge = () => {
    const all = [...p1Games, ...p2Games];
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

  return () => {
    unsub1();
    unsub2();
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
