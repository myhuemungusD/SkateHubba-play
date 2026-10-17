/**
 * Spot group chats — shared types, constants, and doc mappers.
 *
 * Firestore layout (rules: firestore.rules "Spot group chats"; design:
 * docs/SPOT_CHATS.md):
 *   spotChats/{spotId}/messages/{messageId}
 *   spotChats/{spotId}/members/{uid}
 *   spotChats/{spotId}/pushLimits/{recipientUid}
 *   chatMemberships/{uid}     — joined-chat counter (50 cap)
 *   chatReports/{spotId}_{messageId}_{reporterUid}
 *   chatReportLimits/{uid}    — rolling 24h report quota (5 cap)
 *   chatBlocks/{spotId}_{blockedUid}
 *
 * The numeric limits here are mirrored in firestore.rules. Change both or
 * neither.
 */

import type { DocumentData } from "firebase/firestore";

export const SPOT_CHATS_COLLECTION = "spotChats" as const;
export const CHAT_MESSAGES_SUBCOLLECTION = "messages" as const;
export const CHAT_MEMBERS_SUBCOLLECTION = "members" as const;
export const CHAT_PUSH_LIMITS_SUBCOLLECTION = "pushLimits" as const;
export const CHAT_MEMBERSHIPS_COLLECTION = "chatMemberships" as const;
export const CHAT_REPORTS_COLLECTION = "chatReports" as const;
export const CHAT_REPORT_LIMITS_COLLECTION = "chatReportLimits" as const;
export const CHAT_BLOCKS_COLLECTION = "chatBlocks" as const;

export const MAX_MESSAGE_LENGTH = 1000;
export const SEND_COOLDOWN_MS = 1000;
export const MAX_JOINED_CHATS = 50;
export const MAX_REPORTS_PER_DAY = 5;
export const REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_REPORT_DETAILS_LENGTH = 500;
export const DEFAULT_MESSAGES_PAGE_SIZE = 30;
export const MAX_MESSAGES_PAGE_SIZE = 100;

export type ChatMemberRole = "member" | "moderator";
export type ChatHiddenReason = "word_filter";
export type ChatReportReason = "spam" | "harassment" | "inappropriate_content" | "other";
export type ChatReportStatus = "pending" | "reviewed" | "actioned" | "dismissed";

export const CHAT_REPORT_REASON_LABELS: Record<ChatReportReason, string> = {
  spam: "Spam",
  harassment: "Harassment",
  inappropriate_content: "Inappropriate content",
  other: "Other",
};

export interface ChatMessage {
  id: string;
  spotId: string;
  userId: string;
  /** Empty string once deleted. */
  content: string;
  /** Null while the server timestamp is pending (local echo). */
  createdAt: Date | null;
  isDeleted: boolean;
  /** Uid of the moderator who removed it; null for author deletes. */
  moderatedBy: string | null;
  /** Auto-hidden by the word filter. The UI shows a placeholder to others. */
  isHidden: boolean;
  hiddenReason: ChatHiddenReason | null;
}

export interface ChatMember {
  uid: string;
  spotId: string;
  role: ChatMemberRole;
  joinedAt: Date | null;
  /** Read receipt: everything at or before this instant has been seen. */
  lastRead: Date | null;
  /** Presence heartbeat while the chat is open; null when closed. */
  viewingAt: Date | null;
  lastMessageAt: Date | null;
}

export interface SendMessageResult {
  id: string;
  isHidden: boolean;
}

export interface SendMessageOptions {
  /** Shown in the push title, e.g. "kickflip_kid in Hubba Hideout". */
  senderName?: string;
  spotName?: string;
}

/** Opaque pagination cursor returned by getMessages. */
export interface ChatMessagesCursor {
  readonly spotId: string;
  readonly messageId: string;
}

export interface ChatMessagesPage {
  /** Oldest → newest, ready to render. */
  messages: ChatMessage[];
  /** Pass back to fetch older messages; null when there are none. */
  cursor: ChatMessagesCursor | null;
}

/** A user-facing chat error. Its message is safe to show as-is. */
export class ChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatError";
  }
}

/** Thrown when the client-side send cooldown has not elapsed. */
export class ChatRateLimitError extends ChatError {
  constructor(public readonly retryAfterMs: number) {
    super("You're sending messages too fast. Wait a second and try again.");
    this.name = "ChatRateLimitError";
  }
}

/**
 * Rethrow ChatErrors untouched; log anything else and replace it with a
 * friendly ChatError. `deniedMessage` covers rules rejections.
 */
export function toChatError(err: unknown, fallback: string, deniedMessage: string = fallback): ChatError {
  if (err instanceof ChatError) return err;
  return new ChatError(isPermissionDenied(err) ? deniedMessage : fallback);
}

/** Reject empty ids and ids that would escape their path segment. */
export function assertChatId(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || value.includes("/")) {
    throw new ChatError(`Invalid ${label}.`);
  }
}

export function isPermissionDenied(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "permission-denied";
}

export function toDateOrNull(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}

/** Parse a stored counter: a non-negative integer, else 0. */
export function countOf(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function toChatMessage(spotId: string, id: string, data: DocumentData): ChatMessage {
  const isHidden = data.isHidden === true;
  return {
    id,
    spotId,
    userId: stringOr(data.userId, ""),
    content: stringOr(data.content, ""),
    createdAt: toDateOrNull(data.createdAt),
    isDeleted: data.isDeleted === true,
    moderatedBy: typeof data.moderatedBy === "string" ? data.moderatedBy : null,
    isHidden,
    hiddenReason: isHidden ? "word_filter" : null,
  };
}

export function toChatMember(spotId: string, uid: string, data: DocumentData): ChatMember {
  return {
    uid,
    spotId,
    role: data.role === "moderator" ? "moderator" : "member",
    joinedAt: toDateOrNull(data.joinedAt),
    lastRead: toDateOrNull(data.lastRead),
    viewingAt: toDateOrNull(data.viewingAt),
    lastMessageAt: toDateOrNull(data.lastMessageAt),
  };
}

/**
 * Has `member` read `message`? Drives iMessage-style "Read" receipts.
 * Pending server timestamps count as unread.
 */
export function hasMemberRead(member: ChatMember, message: ChatMessage): boolean {
  if (member.uid === message.userId) return true;
  if (!member.lastRead || !message.createdAt) return false;
  return member.lastRead.getTime() >= message.createdAt.getTime();
}

export function chatReportId(spotId: string, messageId: string, reporterUid: string): string {
  return `${spotId}_${messageId}_${reporterUid}`;
}

export function chatBlockId(spotId: string, blockedUid: string): string {
  return `${spotId}_${blockedUid}`;
}
