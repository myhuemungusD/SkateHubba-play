import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  getDoc,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";

/**
 * Block a user. Creates a document in the blocker's `blocked_users` subcollection.
 *
 * Subcollection path: `users/{blockerUid}/blocked_users/{blockedUid}`
 *
 * Apple App Store requires UGC apps to let users block others and suppress
 * their content from all surfaces (feed, challenges, notifications).
 */
export async function blockUser(blockerUid: string, blockedUid: string): Promise<void> {
  if (blockerUid === blockedUid) throw new Error("You cannot block yourself.");
  if (!blockerUid || !blockedUid) throw new Error("Missing user ID.");

  try {
    const ref = doc(requireDb(), "users", blockerUid, "blocked_users", blockedUid);
    await setDoc(ref, {
      blockedUid,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    logger.warn("block_user_failed", {
      blockerUid,
      blockedUid,
      error: parseFirebaseError(err),
    });
    throw new Error("Failed to block user. Please try again.");
  }
}

/**
 * Unblock a user. Deletes the document from the blocker's `blocked_users` subcollection.
 */
export async function unblockUser(blockerUid: string, blockedUid: string): Promise<void> {
  if (!blockerUid || !blockedUid) throw new Error("Missing user ID.");

  try {
    const ref = doc(requireDb(), "users", blockerUid, "blocked_users", blockedUid);
    await deleteDoc(ref);
  } catch (err) {
    logger.warn("unblock_user_failed", {
      blockerUid,
      blockedUid,
      error: parseFirebaseError(err),
    });
    throw new Error("Failed to unblock user. Please try again.");
  }
}

/**
 * Check whether `blockerUid` has blocked `targetUid`.
 */
export async function isUserBlocked(blockerUid: string, targetUid: string): Promise<boolean> {
  if (!blockerUid || !targetUid) return false;
  try {
    const ref = doc(requireDb(), "users", blockerUid, "blocked_users", targetUid);
    const snap = await getDoc(ref);
    return snap.exists();
  } catch (err) {
    logger.warn("is_user_blocked_check_failed", {
      blockerUid,
      targetUid,
      error: parseFirebaseError(err),
    });
    return false;
  }
}

/**
 * Get all UIDs blocked by a given user.
 * Used client-side to filter player directory, leaderboard, and game lists.
 */
export async function getBlockedUserIds(uid: string): Promise<Set<string>> {
  if (!uid) return new Set();
  try {
    const colRef = collection(requireDb(), "users", uid, "blocked_users");
    const snap = await getDocs(colRef);
    return new Set(snap.docs.map((d) => d.id));
  } catch (err) {
    logger.warn("get_blocked_users_failed", {
      uid,
      error: parseFirebaseError(err),
    });
    return new Set();
  }
}

/**
 * Subscribe to the blocked users subcollection for real-time updates.
 * Used by the useBlockedUsers hook to keep the UI in sync.
 */
export function subscribeToBlockedUsers(uid: string, onUpdate: (blockedUids: Set<string>) => void): Unsubscribe {
  const colRef = collection(requireDb(), "users", uid, "blocked_users");

  return onSnapshot(
    colRef,
    (snap) => {
      onUpdate(new Set(snap.docs.map((d) => d.id)));
    },
    (err) => {
      logger.warn("blocked_users_subscription_error", {
        uid,
        error: parseFirebaseError(err),
      });
    },
  );
}
