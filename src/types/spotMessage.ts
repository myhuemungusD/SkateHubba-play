/**
 * Spot group chat message type definitions.
 *
 * Data model:
 *   spots/{spotId}/messages/{messageId}
 *     - userId: string
 *     - content: string (max 500 chars)
 *     - createdAt: Timestamp
 *     - isHidden: boolean (true when flagged by filter or reported+removed)
 *     - hiddenReason?: 'word_filter' | 'reported' | 'user_blocked'
 */

export interface SpotMessage {
  id: string;
  spotId: string;
  userId: string;
  content: string;
  createdAt: string; // ISO 8601
  isHidden: boolean;
  hiddenReason?: "word_filter" | "reported" | "user_blocked";
}

export interface SpotMessageReport {
  id: string;
  messageId: string;
  spotId: string;
  reportedBy: string;
  reason: "spam" | "harassment" | "inappropriate" | "other";
  details?: string;
  createdAt: string;
  status: "pending" | "reviewed" | "dismissed";
}
