/**
 * Crew Challenges — 3v3 team-based skate matches.
 *
 * Each crew has 3 players. The game follows standard S.K.A.T.E. rules
 * but with team turns: one player from each crew goes head-to-head each round.
 */

export type CrewChallengeStatus = "pending" | "active" | "completed" | "cancelled";

export interface CrewMember {
  uid: string;
  username: string;
  avatarUrl?: string;
  letters: string;
  isEliminated: boolean;
}

export interface CrewTeam {
  name: string;
  members: CrewMember[];
  captainUid: string;
}

export interface CrewChallenge {
  uid: string;
  crewA: CrewTeam;
  crewB: CrewTeam;
  status: CrewChallengeStatus;
  currentRound: number;
  currentPlayerAIndex: number;
  currentPlayerBIndex: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  winningCrew?: "A" | "B";
}

export interface CrewInvite {
  uid: string;
  challengeId: string;
  invitedUid: string;
  invitedBy: string;
  crew: "A" | "B";
  status: "pending" | "accepted" | "declined";
  createdAt: number;
}
