/**
 * Spot chat messages: send, paginate, subscribe, soft-delete.
 */

import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  writeBatch,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import { filterContent } from "./chatWordFilter";
import { notifyChatMembers } from "./spotChats.notify";
import {
  CHAT_MEMBERS_SUBCOLLECTION,
  CHAT_MESSAGES_SUBCOLLECTION,
  ChatError,
  ChatRateLimitError,
  DEFAULT_MESSAGES_PAGE_SIZE,
  MAX_MESSAGE_LENGTH,
  MAX_MESSAGES_PAGE_SIZE,
  SEND_COOLDOWN_MS,
  SPOT_CHATS_COLLECTION,
  assertChatId,
  toChatError,
  toChatMessage,
  type ChatMessage,
  type ChatMessagesCursor,
  type ChatMessagesPage,
  type SendMessageOptions,
  type SendMessageResult,
} from "./spotChats.types";

/** Last send attempt per `${uid}_${spotId}`. Client half of the 1 msg/sec limit. */
const lastSendAttempt = new Map<string, number>();

/** Cursor → the snapshot startAfter() needs. Keeps the SDK type out of the public API. */
const cursorSnapshots = new WeakMap<ChatMessagesCursor, QueryDocumentSnapshot>();

/** Test-only: clear the client-side send cooldown. */
export function _resetChatRateLimits(): void {
  lastSendAttempt.clear();
}

function messagesCollection(spotId: string) {
  return collection(requireDb(), SPOT_CHATS_COLLECTION, spotId, CHAT_MESSAGES_SUBCOLLECTION);
}

function chatPushTitle(options: SendMessageOptions): string {
  const where = options.spotName?.trim() || "spot chat";
  const who = options.senderName?.trim();
  return who ? `${who} in ${where}` : `New message in ${where}`;
}

function clampPageSize(pageSize: number): number {
  if (!Number.isFinite(pageSize)) return DEFAULT_MESSAGES_PAGE_SIZE;
  return Math.min(MAX_MESSAGES_PAGE_SIZE, Math.max(1, Math.floor(pageSize)));
}

/**
 * Post a message. Rate limited to one per second per user per spot here and
 * in the rules. Content matching the word filter's auto-hide categories is
 * posted with `isHidden: true` (the rules refuse it otherwise) and is never
 * pushed. Visible messages fan out to offline members in the background.
 */
export async function sendMessage(
  spotId: string,
  content: string,
  uid: string,
  options: SendMessageOptions = {},
): Promise<SendMessageResult> {
  assertChatId(spotId, "spot");
  assertChatId(uid, "user");
  const trimmed = content.trim();
  if (trimmed.length === 0) throw new ChatError("Message can't be empty.");
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new ChatError(`Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`);
  }

  const key = `${uid}_${spotId}`;
  const now = Date.now();
  const last = lastSendAttempt.get(key);
  if (last !== undefined && now - last < SEND_COOLDOWN_MS) {
    throw new ChatRateLimitError(SEND_COOLDOWN_MS - (now - last));
  }
  lastSendAttempt.set(key, now);

  const isHidden = filterContent(trimmed).shouldHide;
  const db = requireDb();
  const messageRef = doc(messagesCollection(spotId));
  const memberRef = doc(db, SPOT_CHATS_COLLECTION, spotId, CHAT_MEMBERS_SUBCOLLECTION, uid);

  // The member update is the rate-limit anchor the create rule requires; it
  // names this message so one anchor bump cannot cover a second message.
  const batch = writeBatch(db);
  batch.set(messageRef, {
    userId: uid,
    content: trimmed,
    createdAt: serverTimestamp(),
    isDeleted: false,
    moderatedBy: null,
    isHidden,
    hiddenReason: isHidden ? "word_filter" : null,
  });
  batch.update(memberRef, {
    lastMessageAt: serverTimestamp(),
    lastMessageId: messageRef.id,
    lastRead: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    lastSendAttempt.delete(key);
    logger.warn("spot_chat_send_failed", { spotId, error: parseFirebaseError(err) });
    throw toChatError(
      err,
      "Failed to send message. Please try again.",
      "Couldn't send. Join this chat first, slow down, or you may be blocked from it.",
    );
  }

  if (!isHidden) {
    void notifyChatMembers({ spotId, senderUid: uid, title: chatPushTitle(options), body: trimmed });
  }
  return { id: messageRef.id, isHidden };
}

/**
 * Fetch one page of history, newest page first. Pass the returned cursor to
 * load the next-older page. Messages from globally blocked users are NOT
 * filtered here (list rules cannot); the caller filters with its block list.
 */
export async function getMessages(
  spotId: string,
  pageSize: number = DEFAULT_MESSAGES_PAGE_SIZE,
  cursor: ChatMessagesCursor | null = null,
): Promise<ChatMessagesPage> {
  assertChatId(spotId, "spot");
  const size = clampPageSize(pageSize);
  const constraints: QueryConstraint[] = [orderBy("createdAt", "desc"), limit(size)];
  if (cursor) {
    const snapshot = cursorSnapshots.get(cursor);
    if (!snapshot || cursor.spotId !== spotId) throw new ChatError("Invalid page cursor.");
    constraints.push(startAfter(snapshot));
  }

  try {
    const snap = await getDocs(query(messagesCollection(spotId), ...constraints));
    const messages = snap.docs.map((d) => toChatMessage(spotId, d.id, d.data())).reverse();
    let nextCursor: ChatMessagesCursor | null = null;
    if (snap.docs.length === size) {
      const oldest = snap.docs[snap.docs.length - 1];
      nextCursor = { spotId, messageId: oldest.id };
      cursorSnapshots.set(nextCursor, oldest);
    }
    return { messages, cursor: nextCursor };
  } catch (err) {
    logger.warn("spot_chat_get_messages_failed", { spotId, error: parseFirebaseError(err) });
    throw toChatError(err, "Failed to load messages.");
  }
}

export interface SubscribeToMessagesOptions {
  /** Most recent N messages to keep live. Defaults to the page size. */
  limit?: number;
  onError?: (error: ChatError) => void;
}

/**
 * Live view of the most recent messages, oldest → newest. Older history is
 * paged in with getMessages.
 */
export function subscribeToMessages(
  spotId: string,
  callback: (messages: ChatMessage[]) => void,
  options: SubscribeToMessagesOptions = {},
): Unsubscribe {
  assertChatId(spotId, "spot");
  const q = query(
    messagesCollection(spotId),
    orderBy("createdAt", "desc"),
    limit(clampPageSize(options.limit ?? DEFAULT_MESSAGES_PAGE_SIZE)),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => toChatMessage(spotId, d.id, d.data())).reverse()),
    (err) => {
      logger.warn("spot_chat_subscription_error", { spotId, error: parseFirebaseError(err) });
      options.onError?.(new ChatError("Lost connection to the chat."));
    },
  );
}

/**
 * Soft delete: blanks the content and sets isDeleted. As the author, the
 * message must be yours; as a moderator, you are stamped as moderatedBy.
 * Idempotent on an already-deleted message.
 */
export async function softDeleteChatMessage(
  spotId: string,
  messageId: string,
  uid: string,
  asModerator: boolean,
): Promise<void> {
  assertChatId(spotId, "spot");
  assertChatId(messageId, "message");
  assertChatId(uid, "user");
  const db = requireDb();
  const ref = doc(db, SPOT_CHATS_COLLECTION, spotId, CHAT_MESSAGES_SUBCOLLECTION, messageId);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new ChatError("That message no longer exists.");
      const data = snap.data();
      if (data.isDeleted === true) return;
      if (asModerator) {
        tx.update(ref, { isDeleted: true, content: "", moderatedBy: uid });
        return;
      }
      if (data.userId !== uid) throw new ChatError("You can only delete your own messages.");
      tx.update(ref, { isDeleted: true, content: "" });
    });
  } catch (err) {
    logger.warn("spot_chat_delete_failed", { spotId, messageId, asModerator, error: parseFirebaseError(err) });
    throw toChatError(err, "Failed to delete message.", "You don't have permission to delete that message.");
  }
}

/** Delete your own message. */
export function deleteMessage(spotId: string, messageId: string, uid: string): Promise<void> {
  return softDeleteChatMessage(spotId, messageId, uid, false);
}
