import { Timestamp } from "firebase/firestore";

/* ────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────── */

export type GameStatus = "active" | "complete" | "forfeit";
/**
 * Game phases:
 *  - setting: setter chooses and records a trick
 *  - matching: matcher attempts, or (if judge active) optionally "calls BS"
 *  - setReview: judge reviews a "Call BS" on the set trick (only with active judge)
 *  - disputable: judge reviews matcher's "landed" claim (only with active judge)
 *
 * The honor-system path (no judge) never enters setReview or disputable.
 */
export type GamePhase = "setting" | "matching" | "setReview" | "disputable";

/** Judge nomination acceptance state. `null` means no judge was ever nominated. */
export type JudgeStatus = "pending" | "accepted" | "declined" | null;

/** A snapshot of a completed turn, stored in the game's turnHistory array. */
export interface TurnRecord {
  turnNumber: number;
  trickName: string;
  setterUid: string;
  setterUsername: string;
  matcherUid: string;
  matcherUsername: string;
  setVideoUrl: string | null;
  matchVideoUrl: string | null;
  landed: boolean;
  /** UID of the player who received a letter, or null if the trick was landed. */
  letterTo: string | null;
  /** UID of the judge who ruled on this turn, or null if no judge was involved. */
  judgedBy?: string | null;
}

/** Create a Firestore Timestamp from epoch milliseconds. Keeps Firebase SDK out of utils/. */
export function timestampFromMillis(ms: number): Timestamp {
  return Timestamp.fromMillis(ms);
}

export interface GameDoc {
  id: string;
  player1Uid: string;
  player2Uid: string;
  player1Username: string;
  player2Username: string;
  p1Letters: number;
  p2Letters: number;
  status: GameStatus;
  /** UID of the player whose turn it is */
  currentTurn: string;
  phase: GamePhase;
  /** UID of the player currently setting a trick */
  currentSetter: string;
  currentTrickName: string | null;
  currentTrickVideoUrl: string | null;
  matchVideoUrl: string | null;
  turnDeadline: Timestamp;
  turnNumber: number;
  winner: string | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  /** Accumulated history of completed turns (for clips replay). */
  turnHistory?: TurnRecord[];
  /** Denormalized verified-pro status for each player (set at game creation). */
  player1IsVerifiedPro?: boolean;
  player2IsVerifiedPro?: boolean;
  /** Optional associated spot for location context. Set at game creation, immutable. */
  spotId?: string | null;
  /**
   * UID of the nominated judge, or null for honor-system games.
   * Honor system: no disputable phase, no "Call BS" option.
   * With judge: dispute/BS flows route to the judge instead of the setter.
   */
  judgeId?: string | null;
  /** Denormalized judge username (for UI), null when no judge nominated. */
  judgeUsername?: string | null;
  /**
   * Judge invite state. null = no judge was ever nominated (pure honor system).
   * pending  → judge hasn't responded yet (game still operates honor-system)
   * accepted → judge is active; dispute/BS routes to them
   * declined → judge said no or 24h window expired (permanent honor system)
   */
  judgeStatus?: JudgeStatus;
  /**
   * UID of the player whose attempt/video is currently under review by the judge.
   * Set when phase transitions to setReview (matcher called BS) or disputable
   * (matcher claimed landed). Null otherwise.
   */
  judgeReviewFor?: string | null;
}

/** Parse a Firestore document snapshot into a typed GameDoc. */
export function toGameDoc(snap: { id: string; data: () => Record<string, unknown> }): GameDoc {
  const raw = snap.data();
  // Validate required fields exist to prevent undefined-as-typed runtime errors
  if (typeof raw.player1Uid !== "string" || typeof raw.player2Uid !== "string" || typeof raw.status !== "string") {
    throw new Error(`Malformed game document: ${snap.id}`);
  }
  return { id: snap.id, ...raw } as GameDoc;
}

/**
 * True when a judge is nominated AND has accepted the invite.
 * Pending/declined/null judges do NOT activate dispute flows — the game
 * proceeds on the honor system until the judge positively accepts.
 */
export function isJudgeActive(game: Pick<GameDoc, "judgeId" | "judgeStatus">): boolean {
  return !!game.judgeId && game.judgeStatus === "accepted";
}

export interface CreateGameOptions {
  challengerIsVerifiedPro?: boolean;
  opponentIsVerifiedPro?: boolean;
  spotId?: string | null;
  /** Optional judge UID — must be different from both players. */
  judgeUid?: string | null;
  /** Denormalized judge username (for UI). Required when judgeUid is set. */
  judgeUsername?: string | null;
}

/**
 * Canonical UUID shape. Matches the API's `UUID_REGEX` in
 * apps/api/src/routes/spots.ts. Malformed values are silently dropped at the
 * service boundary — callers that need to surface "your spot id is bad" UI
 * should validate upstream (e.g. `ChallengeScreen` does via `UUID_SHAPE`).
 */
const SPOT_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeSpotId(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  return SPOT_ID_SHAPE.test(raw) ? raw : null;
}
