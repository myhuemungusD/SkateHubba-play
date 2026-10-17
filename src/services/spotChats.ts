/**
 * Barrel re-export for spot group chats. Implementation lives in:
 *   - spotChats.types.ts       — types, constants, doc mappers, errors
 *   - spotChats.messages.ts    — send / paginate / subscribe / delete
 *   - spotChats.members.ts     — join / leave / read receipts / presence
 *   - spotChats.moderation.ts  — reports, per-chat blocks, roles
 *   - spotChats.notify.ts      — push fan-out to offline members
 * Word filter: chatWordFilter.ts. Gate every UI entry point on
 * isSpotChatsEnabled() (src/lib/featureFlags.ts). Design: docs/SPOT_CHATS.md.
 */

export type {
  ChatHiddenReason,
  ChatMember,
  ChatMemberRole,
  ChatMessage,
  ChatMessagesCursor,
  ChatMessagesPage,
  ChatReportReason,
  ChatReportStatus,
  SendMessageOptions,
  SendMessageResult,
} from "./spotChats.types";
export {
  CHAT_REPORT_REASON_LABELS,
  ChatError,
  ChatRateLimitError,
  DEFAULT_MESSAGES_PAGE_SIZE,
  MAX_JOINED_CHATS,
  MAX_MESSAGE_LENGTH,
  MAX_REPORTS_PER_DAY,
  SEND_COOLDOWN_MS,
  hasMemberRead,
} from "./spotChats.types";

export type { SubscribeToMessagesOptions } from "./spotChats.messages";
export {
  _resetChatRateLimits,
  deleteMessage,
  getMessages,
  sendMessage,
  subscribeToMessages,
} from "./spotChats.messages";

export {
  getChatMember,
  joinChat,
  leaveChat,
  markChatRead,
  setChatViewing,
  subscribeToChatMembers,
} from "./spotChats.members";

export {
  blockUserFromChat,
  isChatModerator,
  removeMessageAsModerator,
  reportMessage,
  setChatMemberRole,
  unblockUserFromChat,
} from "./spotChats.moderation";

export { CHAT_VIEWING_TTL_MS, MAX_CHAT_PUSH_RECIPIENTS, selectChatPushRecipients } from "./spotChats.notify";
