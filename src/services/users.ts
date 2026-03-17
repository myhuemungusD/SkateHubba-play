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
  serverTimestamp,
  type FieldValue,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";

export interface UserProfile {
  uid: string;
  username: string;
  stance: string;
  // serverTimestamp() on write; Firestore Timestamp on read — typed as FieldValue
  // to match what we pass in. The value is never consumed client-side.
  createdAt: FieldValue | null;
  emailVerified: boolean;
  // DEPRECATED: email is no longer written to new profiles to reduce PII exposure.
  // Existing profiles may still have this field; use Firebase Auth for email lookup.
  email?: string;
}

/**
 * Get user profile by UID
 */
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await withRetry(() => getDoc(doc(requireDb(), "users", uid)));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

/**
 * Check if a username is available
 */
export async function isUsernameAvailable(username: string): Promise<boolean> {
  const normalized = username.toLowerCase().trim();
  if (normalized.length < 3 || normalized.length > 20) return false;
  if (!/^[a-z0-9_]+$/.test(normalized)) return false;

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
): Promise<UserProfile> {
  const normalized = username.toLowerCase().trim();

  const db = requireDb();
  const profile = await runTransaction(db, async (tx) => {
    // Check username availability inside transaction
    const usernameRef = doc(db, "usernames", normalized);
    const usernameSnap = await tx.get(usernameRef);

    if (usernameSnap.exists()) {
      throw new Error("Username is already taken");
    }

    // Reserve the username
    tx.set(usernameRef, { uid, reservedAt: serverTimestamp() });

    // Create the user profile — email is intentionally omitted to reduce PII
    // stored in Firestore.  Use Firebase Auth for email lookups instead.
    const userRef = doc(db, "users", uid);
    const profileData: UserProfile = {
      uid,
      username: normalized,
      stance,
      createdAt: serverTimestamp(),
      emailVerified,
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

  // Phase 2: Delete profile + username atomically
  const userRef = doc(db, "users", uid);
  const usernameRef = doc(db, "usernames", username.toLowerCase().trim());
  await runTransaction(db, async (tx) => {
    tx.delete(userRef);
    tx.delete(usernameRef);
  });
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
