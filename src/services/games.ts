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
export type GamePhase = "setting" | "matching" | "confirming";

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

    // Transition to confirming phase — both players review clips and vote
    tx.update(gameRef, {
      phase: "confirming",
      matchVideoUrl,
      setterConfirm: null,
      matcherConfirm: null,
      // currentTurn stays the same (matcher) — but in confirming, either player can act
      turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
      updatedAt: serverTimestamp(),
    });
  });
}

/* ────────────────────────────────────────────
 * Submit confirmation vote (both players vote)
 * ──────────────────────────────────────────── */

export async function submitConfirmation(
  gameId: string,
  playerUid: string,
  landed: boolean,
): Promise<{ gameOver: boolean; winner: string | null; resolved: boolean }> {
  const gameRef = doc(requireDb(), "games", gameId);

  return runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");

    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (game.phase !== "confirming") throw new Error("Not in confirming phase");

    const isSetter = playerUid === game.currentSetter;
    const matcherUid = getOpponent(game, game.currentSetter);

    // Determine which field to set
    let newSetterConfirm = game.setterConfirm;
    let newMatcherConfirm = game.matcherConfirm;

    if (isSetter) {
      if (game.setterConfirm !== null) throw new Error("You already voted");
      newSetterConfirm = landed;
    } else {
      if (game.matcherConfirm !== null) throw new Error("You already voted");
      newMatcherConfirm = landed;
    }

    const updates: Record<string, unknown> = {
      setterConfirm: newSetterConfirm,
      matcherConfirm: newMatcherConfirm,
      updatedAt: serverTimestamp(),
    };

    // If both votes are in, resolve the turn
    if (newSetterConfirm !== null && newMatcherConfirm !== null) {
      // Trick is landed only if BOTH players agree
      const trickLanded = newSetterConfirm && newMatcherConfirm;

      const isP1Matcher = matcherUid === game.player1Uid;
      let newP1Letters = game.p1Letters;
      let newP2Letters = game.p2Letters;

      if (!trickLanded) {
        if (isP1Matcher) newP1Letters++;
        else newP2Letters++;
      }

      const gameOver = newP1Letters >= 5 || newP2Letters >= 5;
      const winner = gameOver ? (newP1Letters >= 5 ? game.player2Uid : game.player1Uid) : null;
      const nextSetter = trickLanded ? matcherUid : game.currentSetter;

      updates.p1Letters = newP1Letters;
      updates.p2Letters = newP2Letters;

      if (gameOver) {
        updates.status = "complete";
        updates.winner = winner;
      } else {
        // Reset to setting phase for the next trick round.
        // Note: we intentionally do NOT reset currentTrickName, currentTrickVideoUrl,
        // matchVideoUrl, setterConfirm, or matcherConfirm here. The Firestore
        // confirmation rule locks those fields to prevent manipulation during votes,
        // and resetting them would violate those locks. These stale values are harmless
        // in the setting phase and are properly cleared by subsequent phase transitions
        // (setTrick resets videos/trick, submitMatchAttempt resets confirms).
        updates.phase = "setting";
        updates.currentSetter = nextSetter;
        updates.currentTurn = nextSetter;
        updates.turnDeadline = Timestamp.fromMillis(Date.now() + TURN_DURATION_MS);
        updates.turnNumber = game.turnNumber + 1;
      }

      tx.update(gameRef, updates);
      return { gameOver, winner, resolved: true };
    }

    tx.update(gameRef, updates);
    return { gameOver: false, winner: null, resolved: false };
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
