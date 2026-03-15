import {
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  runTransaction,
  serverTimestamp,
  type FieldValue,
} from "firebase/firestore";
import { requireDb } from "../firebase";

export interface UserProfile {
  uid: string;
  email: string;
  username: string;
  stance: string;
  // serverTimestamp() on write; Firestore Timestamp on read — typed as FieldValue
  // to match what we pass in. The value is never consumed client-side.
  createdAt: FieldValue | null;
  emailVerified: boolean;
}

/**
 * Get user profile by UID
 */
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(requireDb(), "users", uid));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

/**
 * Check if a username is available
 */
export async function isUsernameAvailable(username: string): Promise<boolean> {
  const normalized = username.toLowerCase().trim();
  if (normalized.length < 3 || normalized.length > 20) return false;
  if (!/^[a-z0-9_]+$/.test(normalized)) return false;

  const snap = await getDoc(doc(requireDb(), "usernames", normalized));
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
  email: string,
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

    // Create the user profile
    const userRef = doc(db, "users", uid);
    const profileData: UserProfile = {
      uid,
      email,
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
 * Call this BEFORE deleteAccount() from auth.ts so Firestore cleanup
 * succeeds while the auth token is still valid.
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
 * Look up a UID by username (for challenging opponents)
 */
export async function getUidByUsername(username: string): Promise<string | null> {
  const normalized = username.toLowerCase().trim();
  const snap = await getDoc(doc(requireDb(), "usernames", normalized));
  if (!snap.exists()) return null;
  return snap.data().uid as string;
}
