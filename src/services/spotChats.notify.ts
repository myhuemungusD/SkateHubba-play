/**
 * Spot chat push fan-out.
 *
 * After a message commits, the sender's client picks which members to wake:
 *  - never the sender
 *  - never a member whose chat is open (viewingAt heartbeat < 60s old)
 *  - never a member pushed for this chat in the last minute (pushLimits)
 * capped at the most recently active members so a huge chat cannot turn
 * one message into hundreds of writes.
 *
 * The pushLimits cooldown is enforced by the rules, so this selection is an
 * optimization, not the guard: a stale read only costs a denied write.
 */

import { Timestamp, collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import { CHAT_PUSH_COOLDOWN_MS, dispatchChatPushNotification } from "./pushDispatch";
import {
  CHAT_MEMBERS_SUBCOLLECTION,
  CHAT_PUSH_LIMITS_SUBCOLLECTION,
  SPOT_CHATS_COLLECTION,
  toChatMember,
  toDateOrNull,
  type ChatMember,
} from "./spotChats.types";

/** Max pushes fanned out per message. */
export const MAX_CHAT_PUSH_RECIPIENTS = 50;
/** A viewingAt heartbeat older than this means the chat is no longer open. */
export const CHAT_VIEWING_TTL_MS = 60_000;
/** Members scanned per message, most recently active first. */
const MAX_MEMBERS_SCANNED = 200;

export interface NotifyChatMembersParams {
  spotId: string;
  senderUid: string;
  title: string;
  body: string;
}

/**
 * Pure recipient selection. `cooledDown` holds recipients pushed within the
 * cooldown window. Exported for tests and for the UI's "who gets pinged" hint.
 */
export function selectChatPushRecipients(
  members: readonly ChatMember[],
  cooledDown: ReadonlySet<string>,
  senderUid: string,
  nowMs: number,
): string[] {
  return members
    .filter((m) => m.uid !== senderUid)
    .filter((m) => m.viewingAt === null || nowMs - m.viewingAt.getTime() >= CHAT_VIEWING_TTL_MS)
    .filter((m) => !cooledDown.has(m.uid))
    .slice(0, MAX_CHAT_PUSH_RECIPIENTS)
    .map((m) => m.uid);
}

/**
 * Fan a chat message out to offline members. Never rejects; resolves with
 * the number of dispatch docs written.
 */
export async function notifyChatMembers(params: NotifyChatMembersParams): Promise<number> {
  try {
    const db = requireDb();
    const nowMs = Date.now();
    const [membersSnap, limitsSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, SPOT_CHATS_COLLECTION, params.spotId, CHAT_MEMBERS_SUBCOLLECTION),
          orderBy("lastRead", "desc"),
          limit(MAX_MEMBERS_SCANNED),
        ),
      ),
      getDocs(
        query(
          collection(db, SPOT_CHATS_COLLECTION, params.spotId, CHAT_PUSH_LIMITS_SUBCOLLECTION),
          where("lastSentAt", ">", Timestamp.fromMillis(nowMs - CHAT_PUSH_COOLDOWN_MS)),
        ),
      ),
    ]);

    const members = membersSnap.docs.map((d) => toChatMember(params.spotId, d.id, d.data()));
    const cooledDown = new Set(
      limitsSnap.docs.filter((d) => toDateOrNull(d.data().lastSentAt) !== null).map((d) => d.id),
    );
    const recipients = selectChatPushRecipients(members, cooledDown, params.senderUid, nowMs);

    const results = await Promise.all(
      recipients.map((recipientUid) =>
        dispatchChatPushNotification({
          senderUid: params.senderUid,
          recipientUid,
          spotId: params.spotId,
          title: params.title,
          body: params.body,
        }),
      ),
    );
    return results.filter(Boolean).length;
  } catch (err) {
    logger.warn("spot_chat_notify_failed", { spotId: params.spotId, error: parseFirebaseError(err) });
    return 0;
  }
}
