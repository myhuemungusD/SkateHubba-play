/** Shared types mirroring the Postgres schema. */

export type GameStatus = "active" | "complete" | "forfeit";
export type GamePhase = "setting" | "matching";
export type NotificationType = "your_turn" | "new_challenge" | "game_won" | "game_lost";

export interface UserRow {
  uid: string;
  username: string;
  stance: string;
  email_verified: boolean;
  dob: string | null;
  parental_consent: boolean | null;
  wins: number;
  losses: number;
  last_stats_game_id: string | null;
  last_game_created_at: Date | null;
  created_at: Date;
}

export interface GameRow {
  id: string;
  player1_uid: string;
  player2_uid: string;
  player1_username: string;
  player2_username: string;
  p1_letters: number;
  p2_letters: number;
  status: GameStatus;
  current_turn: string;
  phase: GamePhase;
  current_setter: string;
  current_trick_name: string | null;
  current_trick_video_url: string | null;
  match_video_url: string | null;
  turn_deadline: Date;
  turn_number: number;
  winner: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface TurnHistoryRow {
  id: string;
  game_id: string;
  turn_number: number;
  trick_name: string;
  setter_uid: string;
  setter_username: string;
  matcher_uid: string;
  matcher_username: string;
  set_video_url: string | null;
  match_video_url: string | null;
  landed: boolean;
  letter_to: string | null;
  created_at: Date;
}

export interface NotificationRow {
  id: string;
  recipient_uid: string;
  type: NotificationType;
  title: string;
  body: string;
  game_id: string | null;
  read: boolean;
  created_at: Date;
}

export interface NudgeRow {
  id: string;
  sender_uid: string;
  sender_username: string;
  recipient_uid: string;
  game_id: string;
  delivered: boolean;
  created_at: Date;
}
