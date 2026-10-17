/**
 * Spot chat moderation: reports, per-chat blocks, moderator removal, roles.
 *
 * Moderators are the spot creator (always) plus members the creator
 * promotes. Per-chat blocks are separate from the global
 * users/{uid}/blocked_users list in blocking.ts: a chat block stops a user
 * joining or posting in ONE spot's chat; it does not hide them elsewhere.
 */

import {
  deleteDoc,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  updateDoc,
  type DocumentData,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import { softDeleteChatMessage } from "./spotChats.messages";
import {
  CHAT_BLOCKS_COLLECTION,
  CHAT_MEMBERS_SUBCOLLECTION,
  CHAT_MESSAGES_SUBCOLLECTION,
  CHAT_REPORT_LIMITS_COLLECTION,
  CHAT_REPORT_REASON_LABELS,
  CHAT_REPORTS_COLLECTION,
  ChatError,
  MAX_REPORT_DETAILS_LENGTH,
  MAX_REPORTS_PER_DAY,
  REPORT_WINDOW_MS,
  SPOT_CHATS_COLLECTION,
  assertChatId,
  chatBlockId,
  chatReportId,
  countOf,
  toChatError,
  toDateOrNull,
  type ChatMemberRole,
  type ChatReportReason,
} from "./spotChats.types";

function isReportReason(value: string): value is ChatReportReason {
  return Object.prototype.hasOwnProperty.call(CHAT_REPORT_REASON_LABELS, value);
}

/** Is `uid` a moderator of this chat? False on any read failure. */
export async function isChatModerator(spotId: string, uid: string): Promise<boolean> {
  assertChatId(spotId, "spot");
  assertChatId(uid, "user");
  try {
    const db = requireDb();
    const spotSnap = await getDoc(doc(db, "spots", spotId));
    if (spotSnap.exists() && spotSnap.data().createdBy === uid) return true;
    const memberSnap = await getDoc(doc(db, SPOT_CHATS_COLLECTION, spotId, CHAT_MEMBERS_SUBCOLLECTION, uid));
    return memberSnap.exists() && memberSnap.data().role === "moderator";
  } catch (err) {
    logger.warn("spot_chat_moderator_check_failed", { spotId, error: parseFirebaseError(err) });
    return false;
  }
}

/** Remove any message as a moderator (or the spot creator). */
export function removeMessageAsModerator(spotId: string, messageId: string, uid: string): Promise<void> {
  return softDeleteChatMessage(spotId, messageId, uid, true);
}

/**
 * Report a message. One report per user per message, at most five per
 * rolling 24h. The report snapshots the message content so deleting the
 * message afterwards does not erase the evidence. Resolves with the report id.
 */
export async function reportMessage(
  spotId: string,
  messageId: string,
  reason: ChatReportReason,
  uid: string,
  details: string = "",
): Promise<string> {
  assertChatId(spotId, "spot");
  assertChatId(messageId, "message");
  assertChatId(uid, "user");
  if (!isReportReason(reason)) throw new ChatError("Please pick a reason for your report.");

  const db = requireDb();
  const reportId = chatReportId(spotId, messageId, uid);
  const reportRef = doc(db, CHAT_REPORTS_COLLECTION, reportId);
  const limitRef = doc(db, CHAT_REPORT_LIMITS_COLLECTION, uid);
  const messageRef = doc(db, SPOT_CHATS_COLLECTION, spotId, CHAT_MESSAGES_SUBCOLLECTION, messageId);

  try {
    await runTransaction(db, async (tx) => {
      const messageSnap = await tx.get(messageRef);
      if (!messageSnap.exists()) throw new ChatError("That message no longer exists.");
      const message = messageSnap.data();
      if (message.userId === uid) throw new ChatError("You can't report your own message.");
      if ((await tx.get(reportRef)).exists()) throw new ChatError("You already reported this message.");

      const limitData: DocumentData = (await tx.get(limitRef)).data() ?? {};
      const windowStart = toDateOrNull(limitData.windowStart);
      const windowOpen = windowStart !== null && Date.now() - windowStart.getTime() < REPORT_WINDOW_MS;
      if (windowOpen) {
        const count = countOf(limitData.count);
        if (count >= MAX_REPORTS_PER_DAY) {
          throw new ChatError(`You can file up to ${MAX_REPORTS_PER_DAY} chat reports a day. Try again tomorrow.`);
        }
        tx.update(limitRef, { count: count + 1, lastReportId: reportId });
      } else {
        tx.set(limitRef, { windowStart: serverTimestamp(), count: 1, lastReportId: reportId });
      }

      tx.set(reportRef, {
        spotId,
        messageId,
        reportedBy: uid,
        reportedUid: message.userId,
        messageContent: message.content,
        reason,
        details: details.trim().slice(0, MAX_REPORT_DETAILS_LENGTH),
        status: "pending",
        createdAt: serverTimestamp(),
      });
    });
    return reportId;
  } catch (err) {
    logger.warn("spot_chat_report_failed", { spotId, messageId, error: parseFirebaseError(err) });
    throw toChatError(err, "Failed to submit report. Please try again.");
  }
}

/**
 * Block `targetUid` from this chat. Requires the moderator role. Nobody can
 * block the spot creator, and only the creator can block another moderator
 * (the rules enforce the latter). Idempotent.
 */
export async function blockUserFromChat(spotId: string, targetUid: string, uid: string): Promise<void> {
  assertChatId(spotId, "spot");
  assertChatId(targetUid, "user");
  assertChatId(uid, "user");
  if (targetUid === uid) throw new ChatError("You can't block yourself.");

  const db = requireDb();
  const blockRef = doc(db, CHAT_BLOCKS_COLLECTION, chatBlockId(spotId, targetUid));
  const spotRef = doc(db, "spots", spotId);
  const moderatorRef = doc(db, SPOT_CHATS_COLLECTION, spotId, CHAT_MEMBERS_SUBCOLLECTION, uid);

  try {
    await runTransaction(db, async (tx) => {
      const spotSnap = await tx.get(spotRef);
      if (!spotSnap.exists()) throw new ChatError("That spot no longer exists.");
      const createdBy: unknown = spotSnap.data().createdBy;
      if (createdBy === targetUid) throw new ChatError("You can't block the spot creator.");
      if (createdBy !== uid) {
        const modSnap = await tx.get(moderatorRef);
        if (!modSnap.exists() || modSnap.data().role !== "moderator") {
          throw new ChatError("Only moderators can block users from this chat.");
        }
      }
      if ((await tx.get(blockRef)).exists()) return;
      tx.set(blockRef, { spotId, blockedUid: targetUid, blockedBy: uid, createdAt: serverTimestamp() });
    });
  } catch (err) {
    logger.warn("spot_chat_block_failed", { spotId, targetUid, error: parseFirebaseError(err) });
    throw toChatError(err, "Failed to block user.", "You don't have permission to block that user.");
  }
}

/** Lift a per-chat block. Moderator-only (rules-enforced). */
export async function unblockUserFromChat(spotId: string, targetUid: string, uid: string): Promise<void> {
  assertChatId(spotId, "spot");
  assertChatId(targetUid, "user");
  assertChatId(uid, "user");
  try {
    await deleteDoc(doc(requireDb(), CHAT_BLOCKS_COLLECTION, chatBlockId(spotId, targetUid)));
  } catch (err) {
    logger.warn("spot_chat_unblock_failed", { spotId, targetUid, error: parseFirebaseError(err) });
    throw toChatError(err, "Failed to unblock user.", "Only moderators can unblock users.");
  }
}

/** Promote or demote another member. Spot creator only (rules-enforced). */
export async function setChatMemberRole(
  spotId: string,
  targetUid: string,
  role: ChatMemberRole,
  uid: string,
): Promise<void> {
  assertChatId(spotId, "spot");
  assertChatId(targetUid, "user");
  assertChatId(uid, "user");
  if (targetUid === uid) throw new ChatError("You can't change your own role.");
  try {
    await updateDoc(doc(requireDb(), SPOT_CHATS_COLLECTION, spotId, CHAT_MEMBERS_SUBCOLLECTION, targetUid), {
      role,
    });
  } catch (err) {
    logger.warn("spot_chat_set_role_failed", { spotId, targetUid, role, error: parseFirebaseError(err) });
    throw toChatError(err, "Failed to update role.", "Only the spot creator can change roles.");
  }
}
