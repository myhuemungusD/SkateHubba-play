/**
 * Spot chat membership: join / leave, read receipts, presence.
 *
 * Join and leave move the per-user chatMemberships counter in the same
 * transaction; the rules require that pairing and cap the counter at 50.
 */

import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import {
  CHAT_MEMBERSHIPS_COLLECTION,
  CHAT_MEMBERS_SUBCOLLECTION,
  ChatError,
  MAX_JOINED_CHATS,
  SPOT_CHATS_COLLECTION,
  assertChatId,
  countOf,
  toChatError,
  toChatMember,
  type ChatMember,
  type ChatMemberRole,
} from "./spotChats.types";

/** Members kept live by subscribeToChatMembers. */
export const MAX_SUBSCRIBED_MEMBERS = 200;

function memberRef(spotId: string, uid: string) {
  return doc(requireDb(), SPOT_CHATS_COLLECTION, spotId, CHAT_MEMBERS_SUBCOLLECTION, uid);
}

/**
 * Join a spot's chat. Idempotent: an existing membership is returned as-is.
 * The spot creator joins as a moderator.
 */
export async function joinChat(spotId: string, uid: string): Promise<ChatMember> {
  assertChatId(spotId, "spot");
  assertChatId(uid, "user");
  const db = requireDb();
  const mRef = memberRef(spotId, uid);
  const countRef = doc(db, CHAT_MEMBERSHIPS_COLLECTION, uid);
  const spotRef = doc(db, "spots", spotId);

  try {
    return await runTransaction(db, async (tx) => {
      const memberSnap = await tx.get(mRef);
      if (memberSnap.exists()) return toChatMember(spotId, uid, memberSnap.data());

      const spotSnap = await tx.get(spotRef);
      if (!spotSnap.exists()) throw new ChatError("That spot no longer exists.");
      const countSnap = await tx.get(countRef);
      const count = countSnap.exists() ? countOf(countSnap.data().count) : 0;
      if (count >= MAX_JOINED_CHATS) {
        throw new ChatError(`You can be in up to ${MAX_JOINED_CHATS} spot chats. Leave one to join another.`);
      }

      const role: ChatMemberRole = spotSnap.data().createdBy === uid ? "moderator" : "member";
      tx.set(mRef, { joinedAt: serverTimestamp(), lastRead: serverTimestamp(), role });
      tx.set(countRef, { count: count + 1, lastSpotId: spotId });
      const member: ChatMember = {
        uid,
        spotId,
        role,
        joinedAt: null,
        lastRead: null,
        viewingAt: null,
        lastMessageAt: null,
      };
      return member;
    });
  } catch (err) {
    logger.warn("spot_chat_join_failed", { spotId, error: parseFirebaseError(err) });
    throw toChatError(err, "Failed to join chat.", "You can't join this chat.");
  }
}

/** Leave a spot's chat. A no-op when not a member. */
export async function leaveChat(spotId: string, uid: string): Promise<void> {
  assertChatId(spotId, "spot");
  assertChatId(uid, "user");
  const db = requireDb();
  const mRef = memberRef(spotId, uid);
  const countRef = doc(db, CHAT_MEMBERSHIPS_COLLECTION, uid);

  try {
    await runTransaction(db, async (tx) => {
      const memberSnap = await tx.get(mRef);
      if (!memberSnap.exists()) return;
      const countSnap = await tx.get(countRef);
      const count = countSnap.exists() ? countOf(countSnap.data().count) : 0;
      tx.delete(mRef);
      tx.set(countRef, { count: Math.max(0, count - 1), lastSpotId: spotId });
    });
  } catch (err) {
    logger.warn("spot_chat_leave_failed", { spotId, error: parseFirebaseError(err) });
    throw toChatError(err, "Failed to leave chat.");
  }
}

/** Read one membership, or null when not a member (or unreadable). */
export async function getChatMember(spotId: string, uid: string): Promise<ChatMember | null> {
  assertChatId(spotId, "spot");
  assertChatId(uid, "user");
  try {
    const snap = await getDoc(memberRef(spotId, uid));
    return snap.exists() ? toChatMember(spotId, uid, snap.data()) : null;
  } catch (err) {
    logger.warn("spot_chat_get_member_failed", { spotId, error: parseFirebaseError(err) });
    return null;
  }
}

async function updateOwnMember(spotId: string, uid: string, data: Record<string, unknown>, event: string) {
  assertChatId(spotId, "spot");
  assertChatId(uid, "user");
  try {
    await updateDoc(memberRef(spotId, uid), data);
  } catch (err) {
    logger.warn(event, { spotId, error: parseFirebaseError(err) });
  }
}

/** Advance the read receipt to now. Best-effort. */
export function markChatRead(spotId: string, uid: string): Promise<void> {
  return updateOwnMember(spotId, uid, { lastRead: serverTimestamp() }, "spot_chat_mark_read_failed");
}

/**
 * Presence heartbeat. Call with `true` when the chat opens and every ~30s
 * while it stays open (suppresses pushes and marks read), and `false` when
 * it closes. Best-effort.
 */
export function setChatViewing(spotId: string, uid: string, viewing: boolean): Promise<void> {
  return updateOwnMember(
    spotId,
    uid,
    { viewingAt: viewing ? serverTimestamp() : null, lastRead: serverTimestamp() },
    "spot_chat_presence_failed",
  );
}

/** Live member list (roles + read receipts), capped at MAX_SUBSCRIBED_MEMBERS. */
export function subscribeToChatMembers(
  spotId: string,
  onUpdate: (members: ChatMember[]) => void,
  onError?: (error: ChatError) => void,
): Unsubscribe {
  assertChatId(spotId, "spot");
  const q = query(
    collection(requireDb(), SPOT_CHATS_COLLECTION, spotId, CHAT_MEMBERS_SUBCOLLECTION),
    limit(MAX_SUBSCRIBED_MEMBERS),
  );
  return onSnapshot(
    q,
    (snap) => onUpdate(snap.docs.map((d) => toChatMember(spotId, d.id, d.data()))),
    (err) => {
      logger.warn("spot_chat_members_subscription_error", { spotId, error: parseFirebaseError(err) });
      onError?.(new ChatError("Lost connection to the chat."));
    },
  );
}
