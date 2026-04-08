import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  runTransaction,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  increment,
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { logger } from "./logger";
import { captureException } from "../lib/sentry";

/* ────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────── */

export interface Spot {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  createdByUid: string;
  createdByUsername: string;
  createdAt: Timestamp | null;
  gameCount: number;
}

/** Data required to create a new spot (excludes server-generated fields). */
export interface CreateSpotInput {
  name: string;
  latitude: number;
  longitude: number;
  createdByUid: string;
  createdByUsername: string;
}

/* ────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────── */

function spotsRef() {
  return collection(requireDb(), "spots");
}

function toSpot(snap: { id: string; data: () => Record<string, unknown> }): Spot {
  const raw = snap.data();
  if (typeof raw.name !== "string" || typeof raw.latitude !== "number" || typeof raw.longitude !== "number") {
    throw new Error(`Malformed spot document: ${snap.id}`);
  }
  return { id: snap.id, ...raw } as Spot;
}

/* ────────────────────────────────────────────
 * CRUD operations
 * ──────────────────────────────────────────── */

/** Create a new skate spot. Returns the new document ID. */
export async function createSpot(input: CreateSpotInput): Promise<string> {
  const safeName = input.name
    .trim()
    // eslint-disable-next-line no-control-regex -- intentionally stripping C0/C1 control characters
    .replace(/[\x00-\x1F\x7F]/g, "")
    .slice(0, 100);
  if (!safeName) throw new Error("Spot name cannot be empty");

  if (input.latitude < -90 || input.latitude > 90) throw new Error("Invalid latitude");
  if (input.longitude < -180 || input.longitude > 180) throw new Error("Invalid longitude");

  const spotData = {
    name: safeName,
    latitude: input.latitude,
    longitude: input.longitude,
    createdByUid: input.createdByUid,
    createdByUsername: input.createdByUsername,
    createdAt: serverTimestamp(),
    gameCount: 0,
  };

  const docRef = await withRetry(() => addDoc(spotsRef(), spotData));
  return docRef.id;
}

/** Fetch a single spot by ID. Returns null if not found. */
export async function getSpotById(spotId: string): Promise<Spot | null> {
  const snap = await withRetry(() => getDoc(doc(requireDb(), "spots", spotId)));
  if (!snap.exists()) return null;
  return toSpot(snap);
}

/** Fetch all spots, ordered by gameCount descending. */
export async function getAllSpots(limitCount: number = 200): Promise<Spot[]> {
  const q = query(spotsRef(), orderBy("gameCount", "desc"), limit(limitCount));
  const snap = await withRetry(() => getDocs(q));
  return snap.docs.map((d) => toSpot(d));
}

/** Fetch spots created by a specific user. */
export async function getSpotsByUser(uid: string): Promise<Spot[]> {
  const q = query(spotsRef(), where("createdByUid", "==", uid), orderBy("gameCount", "desc"), limit(50));
  const snap = await withRetry(() => getDocs(q));
  return snap.docs.map((d) => toSpot(d));
}

/* ────────────────────────────────────────────
 * Tag a game with a spot
 * ──────────────────────────────────────────── */

/**
 * Tag a completed game with a spot. Creates the spot if spotId is not provided,
 * or links to an existing spot. Increments the spot's gameCount.
 * Uses a transaction to prevent double-tagging.
 */
export async function tagGameWithSpot(
  gameId: string,
  spotId: string,
  taggerUid: string,
): Promise<void> {
  const db = requireDb();

  await runTransaction(db, async (tx) => {
    const gameRef = doc(db, "games", gameId);
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists()) throw new Error("Game not found");

    const gameData = gameSnap.data();
    if (gameData.spotId) throw new Error("Game is already tagged with a spot");

    // Verify the tagger is a participant
    if (gameData.player1Uid !== taggerUid && gameData.player2Uid !== taggerUid) {
      throw new Error("Only game participants can tag spots");
    }

    // Verify game is complete
    if (gameData.status === "active") throw new Error("Cannot tag an active game");

    const spotRef = doc(db, "spots", spotId);
    const spotSnap = await tx.get(spotRef);
    if (!spotSnap.exists()) throw new Error("Spot not found");

    tx.update(gameRef, { spotId, spotName: spotSnap.data().name });
    tx.update(spotRef, { gameCount: increment(1) });
  });
}

/* ────────────────────────────────────────────
 * Real-time listeners
 * ──────────────────────────────────────────── */

/** Subscribe to all spots for real-time map updates. */
export function subscribeToSpots(
  onUpdate: (spots: Spot[]) => void,
  limitCount: number = 200,
): Unsubscribe {
  const q = query(spotsRef(), orderBy("gameCount", "desc"), limit(limitCount));

  return onSnapshot(
    q,
    (snap) => {
      onUpdate(snap.docs.map((d) => toSpot(d)));
    },
    (err) => {
      logger.warn("spot_subscription_error", { error: err.message });
      captureException(err, { extra: { context: "subscribeToSpots" } });
    },
  );
}

/** Subscribe to games tagged at a specific spot. */
export function subscribeToSpotGames(
  spotId: string,
  onUpdate: (games: Array<{ id: string; [key: string]: unknown }>) => void,
): Unsubscribe {
  const q = query(
    collection(requireDb(), "games"),
    where("spotId", "==", spotId),
    where("status", "in", ["complete", "forfeit"]),
    orderBy("updatedAt", "desc"),
    limit(50),
  );

  return onSnapshot(
    q,
    (snap) => {
      onUpdate(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    (err) => {
      logger.warn("spot_games_subscription_error", { spotId, error: err.message });
      captureException(err, { extra: { context: "subscribeToSpotGames", spotId } });
    },
  );
}

/** Fetch games tagged at a specific spot (one-time read). */
export async function fetchSpotGames(spotId: string): Promise<Array<{ id: string; [key: string]: unknown }>> {
  const q = query(
    collection(requireDb(), "games"),
    where("spotId", "==", spotId),
    where("status", "in", ["complete", "forfeit"]),
    orderBy("updatedAt", "desc"),
    limit(50),
  );

  const snap = await withRetry(() => getDocs(q));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Update a spot's name (only the creator can do this).
 * Firestore rules enforce ownership.
 */
export async function updateSpotName(spotId: string, name: string): Promise<void> {
  const safeName = name
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, "")
    .slice(0, 100);
  if (!safeName) throw new Error("Spot name cannot be empty");

  await updateDoc(doc(requireDb(), "spots", spotId), { name: safeName });
}
