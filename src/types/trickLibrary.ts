/**
 * Trick Library types.
 *
 * The trick library is a community-curated index of skateboarding tricks
 * with video proof. Each entry shows the trick name, difficulty, and one
 * or more video clips demonstrating it.
 */

export type TrickDifficulty = "beginner" | "intermediate" | "advanced" | "expert";

export interface TrickLibraryEntry {
  uid: string;
  name: string;
  description?: string;
  difficulty: TrickDifficulty;
  videoUrl: string;
  videoThumbnailUrl?: string;
  submittedBy: string;
  submittedAt: number;
  upvotes: number;
  downvotes: number;
  status: "pending" | "approved" | "rejected";
  moderatedBy?: string;
  moderatedAt?: number;
}

export interface TrickVote {
  uid: string;
  trickId: string;
  userId: string;
  vote: "up" | "down";
  createdAt: number;
}
