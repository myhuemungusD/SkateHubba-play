import {
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  writeBatch,
  serverTimestamp,
  type FieldValue,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";

export interface UserProfile {
  uid: string;
  username: string;
  stance: string;
  /** serverTimestamp() on write; Firestore Timestamp on read. */
  createdAt: FieldValue | null;
  emailVerified: boolean;
  /** Date of birth in YYYY-MM-DD format (collected at age gate for COPPA/CCPA compliance). */
  dob?: string;
  /** Whether parental consent was given (for users 13-17 at signup). */
  parentalConsent?: boolean;
  /** Denormalized leaderboard stats — updated atomically when games complete. */
  wins?: number;
  losses?: number;
  /** ID of the last game that updated this user's stats (idempotency key). */
  lastStatsGameId?: string;
}

/**
 * Get user profile by UID
 */
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await withRetry(() => getDoc(doc(requireDb(), "users", uid)));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

/** Username constraints — shared between validation, creation, and UI. */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const USERNAME_RE = /^[a-z0-9_]+$/;

/**
 * Check if a username is available.
 * Returns false for invalid usernames without hitting Firestore.
 */
export async function isUsernameAvailable(username: string): Promise<boolean> {
  const normalized = username.toLowerCase().trim();
  if (normalized.length < USERNAME_MIN || normalized.length > USERNAME_MAX) return false;
  if (!USERNAME_RE.test(normalized)) return false;

  const snap = await withRetry(() => getDoc(doc(requireDb(), "usernames", normalized)));
  return !snap.exists();
}

/**
 * Create user profile with atomic username reservation.
 * Uses a Firestore transaction to prevent race conditions:
 *   1. Check usernames/{username} doesn't exist
 *   2. Write usernames/{username} = { uid }
 *   3. Write users/{uid} = full profile
 */
export async function createProfile(
  uid: string,
  username: string,
  stance: string,
  emailVerified = false,
  dob?: string,
  parentalConsent?: boolean,
): Promise<UserProfile> {
  const normalized = username.toLowerCase().trim();

  if (normalized.length < USERNAME_MIN || normalized.length > USERNAME_MAX) {
    throw new Error(`Username must be ${USERNAME_MIN}–${USERNAME_MAX} characters`);
  }
  if (!USERNAME_RE.test(normalized)) {
    throw new Error("Username may only contain lowercase letters, numbers, and underscores");
  }

  const db = requireDb();
  const profile = await runTransaction(db, async (tx) => {
    const usernameRef = doc(db, "usernames", normalized);
    const usernameSnap = await tx.get(usernameRef);

    if (usernameSnap.exists()) {
      throw new Error("Username is already taken");
    }

    tx.set(usernameRef, { uid, reservedAt: serverTimestamp() });

    const userRef = doc(db, "users", uid);
    const profileData: UserProfile = {
      uid,
      username: normalized,
      stance,
      createdAt: serverTimestamp(),
      emailVerified,
      ...(dob ? { dob } : {}),
      ...(parentalConsent !== undefined ? { parentalConsent } : {}),
    };
    tx.set(userRef, profileData);

    return profileData;
  });

  return profile;
}

/**
 * Delete a user's Firestore data: game documents, profile, and username reservation.
 *
 * Called AFTER deleteAccount() from auth.ts. If this fails, the auth
 * account is already gone and Firestore data is orphaned — the caller
 * should log/alert so it can be cleaned up manually or via a Cloud Function.
 *
 * Phase 1: Delete all game documents where the user is a player.
 * Phase 2: Atomically delete profile + username reservation.
 *
 * Storage videos are orphaned and can be garbage-collected by a lifecycle
 * rule or Cloud Function.
 */
export async function deleteUserData(uid: string, username: string): Promise<void> {
  const db = requireDb();

  // Phase 1: Delete game documents where user is a player
  const gamesCol = collection(db, "games");
  const [asP1, asP2] = await Promise.all([
    getDocs(query(gamesCol, where("player1Uid", "==", uid))),
    getDocs(query(gamesCol, where("player2Uid", "==", uid))),
  ]);
  const seen = new Set<string>();
  const deletions: Promise<void>[] = [];
  for (const snap of [...asP1.docs, ...asP2.docs]) {
    if (!seen.has(snap.id)) {
      seen.add(snap.id);
      deletions.push(deleteDoc(doc(db, "games", snap.id)));
    }
  }
  await Promise.all(deletions);

  // Phase 2: Delete profile + username atomically (no reads needed, batch is cheaper)
  const batch = writeBatch(db);
  batch.delete(doc(db, "users", uid));
  batch.delete(doc(db, "usernames", username.toLowerCase().trim()));
  await batch.commit();
}

/**
 * Fetch all user profiles for the player directory.
 * Capped at 100 for MVP. No real-time listener needed —
 * this is fetched once when the Lobby mounts.
 */
export async function getPlayerDirectory(): Promise<UserProfile[]> {
  const q = query(collection(requireDb(), "users"), orderBy("createdAt", "desc"), limit(100));
  const snap = await withRetry(() => getDocs(q));
  return snap.docs.map((d) => d.data() as UserProfile);
}

/**
 * Look up a UID by username (for challenging opponents)
 */
export async function getUidByUsername(username: string): Promise<string | null> {
  const normalized = username.toLowerCase().trim();
  const snap = await withRetry(() => getDoc(doc(requireDb(), "usernames", normalized)));
  if (!snap.exists()) return null;
  const data = snap.data();
  return typeof data.uid === "string" ? data.uid : null;
}

/**
 * Atomically update a player's win/loss stats after a game completes.
 * Uses lastStatsGameId as an idempotency key to prevent double-counting
 * when subscriptions fire multiple times for the same game.
 *
 * Each player's client calls this for their OWN profile only.
 */
export async function updatePlayerStats(uid: string, gameId: string, won: boolean): Promise<void> {
  const db = requireDb();
  const userRef = doc(db, "users", uid);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists()) return; // profile deleted

    const data = snap.data();
    // Idempotency: skip if this game already counted
    if (data.lastStatsGameId === gameId) return;

    const current = typeof data[won ? "wins" : "losses"] === "number" ? (data[won ? "wins" : "losses"] as number) : 0;

    tx.update(userRef, {
      [won ? "wins" : "losses"]: current + 1,
      lastStatsGameId: gameId,
    });
  });
}

/**
 * Fetch user profiles for the leaderboard, sorted by wins descending.
 * Falls back to client-side sorting since existing users may lack the wins field.
 * Capped at 50 to keep payload and read costs low.
 */
export async function getLeaderboard(): Promise<UserProfile[]> {
  const q = query(collection(requireDb(), "users"), orderBy("createdAt", "desc"), limit(50));
  const snap = await withRetry(() => getDocs(q));
  const profiles = snap.docs.map((d) => d.data() as UserProfile);

  return profiles.sort((a, b) => {
    const aWins = a.wins ?? 0;
    const bWins = b.wins ?? 0;
    if (bWins !== aWins) return bWins - aWins;
    const aTotal = aWins + (a.losses ?? 0);
    const bTotal = bWins + (b.losses ?? 0);
    const aRate = aTotal > 0 ? aWins / aTotal : 0;
    const bRate = bTotal > 0 ? bWins / bTotal : 0;
    if (bRate !== aRate) return bRate - aRate;
    return a.username.localeCompare(b.username);
  });
}
