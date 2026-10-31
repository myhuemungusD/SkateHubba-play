/**
 * What's That Trick (WTT) data model.
 * Server-written items, client-created votes, server-computed reliability.
 */

type WttItemStatus = "open" | "retired" | "pro_queue" | "excluded";

export type WttChoice = string | "unsure" | "not_landed";

export interface WttItem {
  clipId: string;
  trickFamily: string;
  options: readonly [string, string, string, string];
  aliases?: Record<string, string>;
  status: WttItemStatus;
  voteCount: number;
  weightedTally: Record<string, number>;
  top: string | null;
  topPosterior: number;
  createdAt: Date;
  retiredAt?: Date;
}

export interface WttVote {
  clipId: string;
  uid: string;
  choice: WttChoice;
  createdAt: Date;
}

export interface WttReliability {
  reliability: Record<string, number>;
  goldSeen: number;
  goldCorrect: number;
  trickIq: number;
  streakDays: number;
  lastAnsweredDay: string | null;
  freezesLeft: number;
}

export interface ProReview {
  clipId: string;
  uid: string;
  answerTrickId: string;
  note?: string;
  createdAt: Date;
}
