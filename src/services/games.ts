import {
  collection,
  doc,
  addDoc,
  getDoc,
  updateDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "../firebase";

/* ────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────── */

export type GameStatus = "pending" | "active" | "complete" | "forfeit";
export type GamePhase = "setting" | "matching";

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
  createdAt: unknown;
  updatedAt: unknown;
}

const TURN_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const gamesRef = collection(db, "games");

/* ────────────────────────────────────────────
 * Create a new game (challenge)
 * ──────────────────────────────────────────── */

export async function createGame(
  challengerUid: string,
  challengerUsername: string,
  opponentUid: string,
  opponentUsername: string
): Promise<string> {
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
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const docRef = await addDoc(gamesRef, gameData);
  return docRef.id;
}

/* ────────────────────────────────────────────
 * Set a trick (setter's turn)
 * ──────────────────────────────────────────── */

export async function setTrick(
  gameId: string,
  trickName: string,
  videoUrl: string | null
): Promise<void> {
  const gameRef = doc(db, "games", gameId);
  const snap = await getDoc(gameRef);
  if (!snap.exists()) throw new Error("Game not found");

  const game = { id: snap.id, ...snap.data() } as GameDoc;
  if (game.phase !== "setting") throw new Error("Not in setting phase");

  // Determine the matcher (the other player)
  const matcherUid =
    game.currentSetter === game.player1Uid ? game.player2Uid : game.player1Uid;

  await updateDoc(gameRef, {
    phase: "matching",
    currentTrickName: trickName,
    currentTrickVideoUrl: videoUrl,
    matchVideoUrl: null,
    currentTurn: matcherUid,
    turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
    updatedAt: serverTimestamp(),
  });
}

/* ────────────────────────────────────────────
 * Submit match result (matcher self-judges)
 * ──────────────────────────────────────────── */

export async function submitMatchResult(
  gameId: string,
  landed: boolean,
  matchVideoUrl: string | null
): Promise<{ gameOver: boolean; winner: string | null }> {
  const gameRef = doc(db, "games", gameId);
  const snap = await getDoc(gameRef);
  if (!snap.exists()) throw new Error("Game not found");

  const game = { id: snap.id, ...snap.data() } as GameDoc;
  if (game.phase !== "matching") throw new Error("Not in matching phase");

  // Determine who the matcher is
  const matcherUid =
    game.currentSetter === game.player1Uid ? game.player2Uid : game.player1Uid;
  const isP1Matcher = matcherUid === game.player1Uid;

  let newP1Letters = game.p1Letters;
  let newP2Letters = game.p2Letters;

  // Missed trick = earn a letter
  if (!landed) {
    if (isP1Matcher) newP1Letters++;
    else newP2Letters++;
  }

  // Check game over
  const gameOver = newP1Letters >= 5 || newP2Letters >= 5;
  const winner = gameOver
    ? newP1Letters >= 5
      ? game.player2Uid // p1 lost, p2 wins
      : game.player1Uid // p2 lost, p1 wins
    : null;

  // Next turn: if landed, matcher becomes setter. If missed, same setter sets again.
  const nextSetter = landed ? matcherUid : game.currentSetter;

  const updates: Record<string, unknown> = {
    p1Letters: newP1Letters,
    p2Letters: newP2Letters,
    matchVideoUrl,
    updatedAt: serverTimestamp(),
  };

  if (gameOver) {
    updates.status = "complete";
    updates.winner = winner;
  } else {
    updates.phase = "setting";
    updates.currentSetter = nextSetter;
    updates.currentTurn = nextSetter;
    updates.currentTrickName = null;
    updates.currentTrickVideoUrl = null;
    updates.matchVideoUrl = null;
    updates.turnDeadline = Timestamp.fromMillis(Date.now() + TURN_DURATION_MS);
    updates.turnNumber = game.turnNumber + 1;
  }

  await updateDoc(gameRef, updates);
  return { gameOver, winner };
}

/* ────────────────────────────────────────────
 * Real-time listeners
 * ──────────────────────────────────────────── */

/**
 * Subscribe to all games where the user is a player.
 * Returns unsubscribe function.
 */
export function subscribeToMyGames(
  uid: string,
  onUpdate: (games: GameDoc[]) => void
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

  const q1 = query(gamesRef, where("player1Uid", "==", uid));
  const q2 = query(gamesRef, where("player2Uid", "==", uid));

  const unsub1 = onSnapshot(q1, (snap) => {
    p1Games = snap.docs.map((d) => ({ id: d.id, ...d.data() } as GameDoc));
    merge();
  });

  const unsub2 = onSnapshot(q2, (snap) => {
    p2Games = snap.docs.map((d) => ({ id: d.id, ...d.data() } as GameDoc));
    merge();
  });

  return () => {
    unsub1();
    unsub2();
  };
}

/**
 * Subscribe to a single game for real-time updates
 */
export function subscribeToGame(
  gameId: string,
  onUpdate: (game: GameDoc | null) => void
): Unsubscribe {
  return onSnapshot(doc(db, "games", gameId), (snap) => {
    if (!snap.exists()) {
      onUpdate(null);
      return;
    }
    onUpdate({ id: snap.id, ...snap.data() } as GameDoc);
  });
}
