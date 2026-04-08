import {
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  setDoc,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";

export interface BlockRecord {
  blockedUid: string;
  blockedUsername: string;
  createdAt: ReturnType<typeof serverTimestamp> | null;
}

/**
 * Block a user. Creates a doc in the blocker's blockedUsers subcollection.
 */
export async function blockUser(blockerUid: string, blockedUid: string, blockedUsername: string): Promise<void> {
  if (blockerUid === blockedUid) throw new Error("You cannot block yourself.");

  const db = requireDb();
  const blockRef = doc(db, "users", blockerUid, "blockedUsers", blockedUid);

  await setDoc(blockRef, {
    blockedUid,
    blockedUsername,
    createdAt: serverTimestamp(),
  });

  logger.info("user_blocked", { blockerUid, blockedUid });
}

/**
 * Unblock a user. Removes the doc from the blocker's blockedUsers subcollection.
 */
export async function unblockUser(blockerUid: string, blockedUid: string): Promise<void> {
  const db = requireDb();
  const blockRef = doc(db, "users", blockerUid, "blockedUsers", blockedUid);
  await deleteDoc(blockRef);
  logger.info("user_unblocked", { blockerUid, blockedUid });
}

/**
 * Check if blockerUid has blocked blockedUid.
 */
export async function isUserBlocked(blockerUid: string, blockedUid: string): Promise<boolean> {
  const db = requireDb();
  const blockRef = doc(db, "users", blockerUid, "blockedUsers", blockedUid);
  const snap = await getDoc(blockRef);
  return snap.exists();
}

/**
 * Check if either user has blocked the other (bidirectional check).
 * Used before game creation to prevent challenges between blocked users.
 */
export async function isEitherBlocked(uid1: string, uid2: string): Promise<boolean> {
  const [blocked1, blocked2] = await Promise.all([isUserBlocked(uid1, uid2), isUserBlocked(uid2, uid1)]);
  return blocked1 || blocked2;
}

/**
 * Fetch all blocked users for a given user (one-time read).
 */
export async function getBlockedUsers(uid: string): Promise<BlockRecord[]> {
  const db = requireDb();
  const colRef = collection(db, "users", uid, "blockedUsers");
  const snap = await getDocs(colRef);
  return snap.docs.map((d) => d.data() as BlockRecord);
}

/**
 * Subscribe to the blocked users subcollection for real-time updates.
 */
export function subscribeToBlockedUsers(uid: string, onUpdate: (blockedUids: Set<string>) => void): Unsubscribe {
  const db = requireDb();
  const colRef = collection(db, "users", uid, "blockedUsers");

  return onSnapshot(
    colRef,
    (snap) => {
      const uids = new Set<string>();
      for (const d of snap.docs) {
        const data = d.data();
        if (typeof data.blockedUid === "string") {
          uids.add(data.blockedUid);
        }
      }
      onUpdate(uids);
    },
    (err) => {
      logger.warn("blocked_users_subscription_error", {
        uid,
        error: parseFirebaseError(err),
      });
    },
  );
}
