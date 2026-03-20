/**
 * SkateHubba™ Profile Types
 * Single source of truth for user profile data model.
 * These types map directly to Firestore document shapes.
 */

/** Stats embedded in the user document — updated atomically during game resolution */
export interface PlayerStats {
  wins: number;
  losses: number;
  forfeits: number;
  currentStreak: number;
  bestStreak: number;
}

/** Firestore `users/{uid}` document shape */
export interface UserProfile {
  uid: string;
  displayName: string;
  username: string; // lowercase, URL-safe, unique via `usernames` collection
  photoURL: string | null;
  bio: string; // max 150 chars
  stats: PlayerStats;
  createdAt: number; // Firestore serverTimestamp as millis
}

/** Firestore `usernames/{username}` document — enforces uniqueness */
export interface UsernameRecord {
  uid: string;
}

/** Completed game summary for profile game history */
export interface GameSummary {
  id: string;
  opponentUid: string;
  opponentDisplayName: string;
  opponentUsername: string;
  opponentPhotoURL: string | null;
  result: 'win' | 'loss' | 'forfeit';
  myLetters: number; // 0-5
  opponentLetters: number; // 0-5
  completedAt: number;
}

/** Profile edit form data */
export interface ProfileEditPayload {
  displayName: string;
  username: string;
  bio: string;
  photoURL: string | null;
}

/** Validation result for username checks */
export interface UsernameValidation {
  valid: boolean;
  error: string | null;
}
