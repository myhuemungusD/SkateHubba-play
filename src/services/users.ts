import {
  doc,
  getDoc,
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
  emailVerified = false
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
 * Delete a user's Firestore profile and username reservation atomically.
 * Uses a transaction so both documents are deleted together — if one fails
 * neither is deleted, preventing orphaned username reservations.
 *
 * Call this BEFORE deleteAccount() from auth.ts so Firestore cleanup
 * succeeds while the auth token is still valid.
 *
 * Note: game documents and Storage videos are intentionally retained for
 * opponent history. A Cloud Function can handle deeper cleanup if needed.
 */
export async function deleteUserData(uid: string, username: string): Promise<void> {
  const db = requireDb();
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
