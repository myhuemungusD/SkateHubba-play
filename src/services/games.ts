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
import { metrics } from "./logger";
import { captureException } from "../lib/sentry";

/* ────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────── */

export type GameStatus = "active" | "complete" | "forfeit";
export type GamePhase = "setting" | "matching" | "confirming" | "disputed";

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
  /** Setter's vote on whether the matcher landed (null = not yet voted) */
  setterConfirm: boolean | null;
  /** Matcher's vote on whether they landed (null = not yet voted) */
  matcherConfirm: boolean | null;
  turnDeadline: Timestamp;
  turnNumber: number;
  winner: string | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  /** Accumulated history of completed turns (for clips replay). */
  turnHistory?: TurnRecord[];
  /** ID of the active dispute (set when phase = 'disputed'). */
  disputeId?: string | null;
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
 * Create a new game (challenge)
 * ──────────────────────────────────────────── */

// Client-side rate limit: one game creation per 10 seconds (defense-in-depth)
let lastGameCreatedAt = 0;
const GAME_CREATE_COOLDOWN_MS = 10_000;

/** @internal Reset rate-limit state (for tests only) */
export function _resetCreateGameRateLimit() {
  lastGameCreatedAt = 0;
}

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
    setterConfirm: null,
    matcherConfirm: null,
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
  return docRef.id;
}

/* ────────────────────────────────────────────
 * Set a trick (setter's turn)
 * ──────────────────────────────────────────── */

export async function setTrick(gameId: string, trickName: string, videoUrl: string | null): Promise<void> {
  // Sanitise at the service boundary: trim whitespace, cap length
  const safeTrickName = trickName.trim().slice(0, 100);
  if (!safeTrickName) throw new Error("Trick name cannot be empty");

  const gameRef = doc(requireDb(), "games", gameId);

  // Firestore transactions have built-in retry for transient conflicts;
  // withRetry is not needed here and would incorrectly retry app-logic errors.
  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");

    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (game.phase !== "setting") throw new Error("Not in setting phase");

    const matcherUid = getOpponent(game, game.currentSetter);

    tx.update(gameRef, {
      phase: "matching",
      currentTrickName: safeTrickName,
      currentTrickVideoUrl: videoUrl,
      matchVideoUrl: null,
      currentTurn: matcherUid,
      turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
      updatedAt: serverTimestamp(),
    });
  });
}

/* ────────────────────────────────────────────
 * Setter failed to land their trick — turn passes
 * ──────────────────────────────────────────── */

export async function failSetTrick(gameId: string): Promise<void> {
  const gameRef = doc(requireDb(), "games", gameId);

  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");

    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (game.phase !== "setting") throw new Error("Not in setting phase");

    const nextSetter = getOpponent(game, game.currentSetter);

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
  });
}

/* ────────────────────────────────────────────
 * Submit match attempt (transitions to confirming)
 * ──────────────────────────────────────────── */

export async function submitMatchAttempt(gameId: string, matchVideoUrl: string | null): Promise<void> {
  const gameRef = doc(requireDb(), "games", gameId);

  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");

    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (game.phase !== "matching") throw new Error("Not in matching phase");

    // Transition to confirming phase — both players review and vote independently.
    // currentTurn stays on setter (for display), but both can submit votes.
    tx.update(gameRef, {
      phase: "confirming",
      matchVideoUrl,
      setterConfirm: null,
      matcherConfirm: null,
      currentTurn: game.currentSetter,
      turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
      updatedAt: serverTimestamp(),
    });
  });
}

/* ────────────────────────────────────────────
 * Submit confirmation vote (dual-vote: both setter AND matcher vote)
 *
 * Either player can vote first. When both votes are in:
 *   • Agree → auto-resolve (letter assigned or not)
 *   • Disagree → game transitions to 'disputed' phase
 * ──────────────────────────────────────────── */

export async function submitConfirmation(
  gameId: string,
  playerUid: string,
  landed: boolean,
): Promise<{ gameOver: boolean; winner: string | null; disputed?: boolean }> {
  const gameRef = doc(requireDb(), "games", gameId);

  return runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");

    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (game.phase !== "confirming") throw new Error("Not in confirming phase");

    const isSetter = playerUid === game.currentSetter;
    const matcherUid = getOpponent(game, game.currentSetter);
    const isMatcher = playerUid === matcherUid;

    if (!isSetter && !isMatcher) throw new Error("Not a player in this game");

    if (isSetter && game.setterConfirm !== null) throw new Error("You already voted");
    if (isMatcher && game.matcherConfirm !== null) throw new Error("You already voted");

    const updates: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };

    if (isSetter) {
      updates.setterConfirm = landed;
    } else {
      updates.matcherConfirm = landed;
    }

    // Check if this is the second vote (the other player already voted)
    const otherVote = isSetter ? game.matcherConfirm : game.setterConfirm;
    const bothVoted = otherVote !== null;

    if (!bothVoted) {
      // First vote — just record it and wait for the other player
      tx.update(gameRef, updates);
      return { gameOver: false, winner: null };
    }

    // Both players have now voted — determine outcome
    const setterVote = isSetter ? landed : (game.setterConfirm as boolean);
    const matcherVote = isMatcher ? landed : (game.matcherConfirm as boolean);

    if (setterVote !== matcherVote) {
      // Disagreement → create a dispute and transition game to disputed phase
      const disputeRef = doc(collection(requireDb(), "disputes"));
      const setterUsername = game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username;
      const matcherUsernameVal = game.player1Uid === game.currentSetter ? game.player2Username : game.player1Username;

      tx.set(disputeRef, {
        gameId,
        turnNumber: game.turnNumber,
        trickName: game.currentTrickName || "Trick",
        setterUid: game.currentSetter,
        matcherUid,
        setterUsername,
        matcherUsername: matcherUsernameVal,
        setVideoUrl: game.currentTrickVideoUrl,
        matchVideoUrl: game.matchVideoUrl,
        setterVote,
        matcherVote,
        status: "open",
        resolution: null,
        juryVotes: {},
        jurySize: 0,
        createdAt: serverTimestamp(),
      });

      updates.phase = "disputed";
      updates.disputeId = disputeRef.id;
      tx.update(gameRef, updates);
      return { gameOver: false, winner: null, disputed: true };
    }

    // Agreement — resolve the turn
    const agreedLanded = setterVote; // both agree
    const isP1Matcher = matcherUid === game.player1Uid;
    let newP1Letters = game.p1Letters;
    let newP2Letters = game.p2Letters;

    if (!agreedLanded) {
      if (isP1Matcher) newP1Letters++;
      else newP2Letters++;
    }

    const gameOver = newP1Letters >= 5 || newP2Letters >= 5;
    const winner = gameOver ? (newP1Letters >= 5 ? game.player2Uid : game.player1Uid) : null;
    const nextSetter = agreedLanded ? matcherUid : game.currentSetter;

    updates.p1Letters = newP1Letters;
    updates.p2Letters = newP2Letters;

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
      matchVideoUrl: game.matchVideoUrl,
      landed: agreedLanded,
      letterTo: agreedLanded ? null : matcherUid,
    };
    updates.turnHistory = arrayUnion(turnRecord);

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
    return { gameOver, winner };
  });
}

/* ────────────────────────────────────────────
 * Resolve a dispute (called by either player after jury reaches verdict)
 * ──────────────────────────────────────────── */

export async function resolveDispute(
  gameId: string,
  disputeId: string,
  landed: boolean,
): Promise<{ gameOver: boolean; winner: string | null }> {
  const gameRef = doc(requireDb(), "games", gameId);
  const disputeRef = doc(requireDb(), "disputes", disputeId);

  return runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");

    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (game.phase !== "disputed") throw new Error("Game is not in disputed phase");

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

    // Record this turn in the history
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
      matchVideoUrl: game.matchVideoUrl,
      landed,
      letterTo: landed ? null : matcherUid,
    };

    const gameUpdates: Record<string, unknown> = {
      p1Letters: newP1Letters,
      p2Letters: newP2Letters,
      setterConfirm: null,
      matcherConfirm: null,
      disputeId: null,
      turnHistory: arrayUnion(turnRecord),
      updatedAt: serverTimestamp(),
    };

    if (gameOver) {
      gameUpdates.status = "complete";
      gameUpdates.winner = winner;
    } else {
      gameUpdates.phase = "setting";
      gameUpdates.currentSetter = nextSetter;
      gameUpdates.currentTurn = nextSetter;
      gameUpdates.turnDeadline = Timestamp.fromMillis(Date.now() + TURN_DURATION_MS);
      gameUpdates.turnNumber = game.turnNumber + 1;
    }

    // Mark dispute as resolved
    tx.update(disputeRef, {
      status: "resolved",
      resolution: landed,
    });

    tx.update(gameRef, gameUpdates);
    return { gameOver, winner };
  });
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
 * Returns unsubscribe function.
 */
export function subscribeToMyGames(uid: string, onUpdate: (games: GameDoc[]) => void): Unsubscribe {
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

  const q1 = query(gamesRef(), where("player1Uid", "==", uid), limit(50));
  const q2 = query(gamesRef(), where("player2Uid", "==", uid), limit(50));

  const handleError = (err: Error) => {
    console.warn("Game subscription error for uid:", uid, err.message);
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
      console.warn("Game subscription error for game:", gameId, err.message);
      captureException(err, { extra: { context: "subscribeToGame", gameId } });
      onUpdate(null);
    },
  );
}
