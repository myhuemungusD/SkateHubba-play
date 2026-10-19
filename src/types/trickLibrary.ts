/**
 * Trick Library types. A community index of skateboarding tricks: anyone can
 * submit one, an admin approves it, and skaters vote approved tricks up or down.
 */

export type TrickDifficulty = "beginner" | "intermediate" | "advanced" | "expert";
export type TrickStatus = "pending" | "approved" | "rejected";
export type TrickVoteValue = "up" | "down";

export const TRICK_DIFFICULTIES: readonly TrickDifficulty[] = ["beginner", "intermediate", "advanced", "expert"];
export const TRICK_NAME_MAX = 60;
export const TRICK_DESCRIPTION_MAX = 500;

export interface TrickLibraryEntry {
  id: string;
  name: string;
  description?: string;
  difficulty: TrickDifficulty;
  /** Optional Firebase Storage clip proving the trick (bucket-pinned in rules). */
  videoUrl?: string;
  submittedBy: string;
  /** Epoch ms; 0 while the server timestamp is still pending. */
  submittedAt: number;
  status: TrickStatus;
}

export interface TrickScore {
  up: number;
  down: number;
}
