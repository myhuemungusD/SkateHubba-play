/**
 * SDK-agnostic community-dispute resolution logic.
 *
 * This module contains ZERO Firebase imports. It is the single source of truth
 * for "what happens when a binding community trick-dispute resolves", modelled
 * on `turnForfeit.shared.ts`. It is intended to be shared, byte-for-byte, by:
 *
 *   • the server "dispute referee" cron (Phase 4), running via firebase-admin,
 *     which tallies votes at the vote deadline and applies the outcome, and
 *   • any client / admin-referee surface (Phase 3/5) that needs to preview or
 *     apply the identical game-state + stat effect.
 *
 * Both callers feed in a plain `GameDoc` plus the vote tally plus `nowMs` and
 * translate the returned decision into their SDK's write objects. Because the
 * verdict math, role/letter math, TurnRecord shape and the four stat deltas all
 * live here, the paths can never diverge.
 *
 * The helper is intentionally pure: no I/O, no clock reads (the caller passes
 * `nowMs`), no Timestamp construction (callers turn `*Ms` numbers into their
 * SDK's Timestamp). This keeps it unit-testable in isolation.
 *
 * See docs/DISPUTE_BINDING_DESIGN.md §2 (stats) and §3.4 (outcomes) — this file
 * implements that contract exactly.
 */

import { TURN_DURATION_MS } from "./turnDuration.js";
import type { GameDoc, TurnRecord } from "./games.mappers.js";

/** How many letters ends the game. Reuse the pin the honor/judge paths enforce. */
const LOSING_LETTER_COUNT = 5;

/** The opponent of `playerUid` in a two-player game. Mirrors getOpponent. */
function opponentOf(game: GameDoc, playerUid: string): string {
  return playerUid === game.player1Uid ? game.player2Uid : game.player1Uid;
}

/** Username of `playerUid` (only p1/p2 are valid inputs). */
function usernameOf(game: GameDoc, playerUid: string): string {
  return playerUid === game.player1Uid ? game.player1Username : game.player2Username;
}

/** The community vote tally for a single dispute. "make" = `land` in schema. */
export interface DisputeTally {
  /** Votes that the matcher DID land the trick (claim upheld). */
  landVotes: number;
  /** Votes that the matcher did NOT land (claim overturned). */
  bailVotes: number;
}

/**
 * The verdict a resolution reaches:
 *  - "land" — land majority, claim upheld (honor swap).
 *  - "bail" — bail majority, claim overturned (matcher takes a letter).
 *  - "tie"  — equal land/bail, both ≥1 (retry, no letter).
 *  - "none" — zero votes at deadline (below quorum → auto-accept, no right/wrong).
 */
export type DisputeVerdict = "land" | "bail" | "tie" | "none";

/**
 * Game-doc field writes to apply on resolution. `*Ms` values are plain numbers
 * so each SDK builds its own Timestamp; `reviewFor`/`reviewDeadline` are always
 * cleared (the review is over). `updatedAt` is intentionally omitted — callers
 * stamp it with their SDK's serverTimestamp().
 */
export interface DisputeGameUpdate {
  phase?: GameDoc["phase"];
  status?: GameDoc["status"];
  winner?: string;
  currentSetter?: string;
  currentTurn?: string;
  turnNumber?: number;
  /** Epoch ms for the new turn deadline; caller converts to a Timestamp. Absent on terminal (game-over) bail. */
  turnDeadlineMs?: number;
  p1Letters?: number;
  p2Letters?: number;
  /** Cleared on tie/retry so the matcher re-records a fresh attempt. Absent otherwise. */
  matchVideoUrl?: null;
  /** Always cleared — the review phase is resolved. */
  reviewFor: null;
  /** Always cleared — the review phase is resolved. */
  reviewDeadline: null;
  /** TurnRecord to append via the SDK's arrayUnion. Absent on tie/retry (turn not resolved). */
  appendTurnRecord?: TurnRecord;
  /** Server-authored pointer to the deterministic dispute result document. */
  lastResolvedDisputeTurnNumber?: number;
}

/**
 * The four §2 counters, split by recipient. Every resolved dispute increments
 * the claimer's `tricksDisputed` and the disputer's `disputesRaised` (a dispute
 * occurred); only land/bail additionally bump `disputesWrong`/`disputesRight`.
 * Values are deltas to apply with the SDK's increment().
 */
export interface DisputeStatDeltas {
  /** Applied to the claimer (matcher = reviewFor). */
  claimer: {
    uid: string;
    tricksDisputed: number;
  };
  /** Applied to the disputer (setter = currentSetter). */
  disputer: {
    uid: string;
    disputesRaised: number;
    /** +1 on a bail verdict (community sided with the disputer). */
    disputesRight: number;
    /** +1 on a land verdict (community sided against the disputer). */
    disputesWrong: number;
  };
}

export interface DisputeResolutionDecision {
  verdict: DisputeVerdict;
  /** Winner UID when a bail verdict completes the game; null otherwise. */
  winnerUid: string | null;
  gameUpdate: DisputeGameUpdate;
  statDeltas: DisputeStatDeltas;
}

/** Classify the tally into a verdict. Quorum is 1 vote (0 total → "none"). */
export function classifyVerdict(tally: DisputeTally): DisputeVerdict {
  const { landVotes, bailVotes } = tally;
  if (landVotes === 0 && bailVotes === 0) return "none";
  if (landVotes > bailVotes) return "land";
  if (bailVotes > landVotes) return "bail";
  return "tie";
}

/**
 * Build the "honor swap" TurnRecord + shared fields for a landed resolution.
 * Used by both a land verdict, a zero-vote auto-accept, and the pendingReview
 * expiry auto-accept — the matcher becomes the next setter, no letter.
 */
function landedTurnRecord(game: GameDoc, matcherUid: string): TurnRecord {
  const setterUid = game.currentSetter;
  return {
    turnNumber: game.turnNumber,
    trickName: game.currentTrickName || "Trick",
    setterUid,
    setterUsername: usernameOf(game, setterUid),
    matcherUid,
    matcherUsername: usernameOf(game, matcherUid),
    setVideoUrl: game.currentTrickVideoUrl,
    matchVideoUrl: game.matchVideoUrl,
    landed: true,
    letterTo: null,
    judgedBy: null,
  };
}

/** The honor-swap game update: matcher becomes setter, turn advances, no letter. */
function honorSwapUpdate(game: GameDoc, matcherUid: string, nowMs: number): DisputeGameUpdate {
  return {
    phase: "setting",
    currentSetter: matcherUid,
    currentTurn: matcherUid,
    turnNumber: game.turnNumber + 1,
    turnDeadlineMs: nowMs + TURN_DURATION_MS,
    p1Letters: game.p1Letters,
    p2Letters: game.p2Letters,
    reviewFor: null,
    reviewDeadline: null,
    appendTurnRecord: landedTurnRecord(game, matcherUid),
  };
}

/**
 * Decide how a `communityReview` dispute resolves, given its vote tally.
 *
 * `matcher` = claimer = `reviewFor`; `setter` = disputer = `currentSetter`.
 * Implements docs/DISPUTE_BINDING_DESIGN.md §3.4 + §2 exactly.
 *
 * The caller is responsible for eligibility gating (phase === communityReview,
 * deadline passed, dispute still open). This helper is pure decision math and
 * assumes it is called on an eligible game.
 */
export function decideDisputeResolution(game: GameDoc, tally: DisputeTally, nowMs: number): DisputeResolutionDecision {
  const matcherUid = game.reviewFor ?? opponentOf(game, game.currentSetter);
  const disputerUid = game.currentSetter;
  const verdict = classifyVerdict(tally);

  // Every resolved dispute records the two raw counts. Per §2's stated
  // assumption, the zero-vote ("none") auto-accept ALSO increments them (a
  // dispute WAS raised, so it counts). OWNER-CONFIRMABLE NUANCE: flip these two
  // to 0 for the "none" verdict if zero-vote should be fully stat-neutral.
  const statDeltas: DisputeStatDeltas = {
    claimer: { uid: matcherUid, tricksDisputed: 1 },
    disputer: {
      uid: disputerUid,
      disputesRaised: 1,
      disputesRight: verdict === "bail" ? 1 : 0,
      disputesWrong: verdict === "land" ? 1 : 0,
    },
  };

  // ── land majority OR zero-vote auto-accept → honor swap (no letter) ──
  // Identical game effect; they differ only in the disputesWrong stat above.
  if (verdict === "land" || verdict === "none") {
    return {
      verdict,
      winnerUid: null,
      gameUpdate: {
        ...honorSwapUpdate(game, matcherUid, nowMs),
        lastResolvedDisputeTurnNumber: game.turnNumber,
      },
      statDeltas,
    };
  }

  // ── tie → retry: matcher re-attempts the same trick, no letter, no record ──
  if (verdict === "tie") {
    return {
      verdict,
      winnerUid: null,
      gameUpdate: {
        lastResolvedDisputeTurnNumber: game.turnNumber,
        phase: "matching",
        // Setter unchanged; the matcher is back on the clock to re-attempt.
        currentSetter: disputerUid,
        currentTurn: matcherUid,
        turnDeadlineMs: nowMs + TURN_DURATION_MS,
        matchVideoUrl: null,
        reviewFor: null,
        reviewDeadline: null,
      },
      statDeltas,
    };
  }

  // ── bail majority → matcher takes one letter ──
  const isP1Matcher = matcherUid === game.player1Uid;
  const p1Letters = game.p1Letters + (isP1Matcher ? 1 : 0);
  const p2Letters = game.p2Letters + (isP1Matcher ? 0 : 1);
  const matcherLetters = isP1Matcher ? p1Letters : p2Letters;
  const gameOver = matcherLetters >= LOSING_LETTER_COUNT;

  const turnRecord: TurnRecord = {
    ...landedTurnRecord(game, matcherUid),
    landed: false,
    letterTo: matcherUid,
  };

  if (gameOver) {
    // Matcher hit 5 → game ends, winner is the setter (the non-5 player).
    return {
      verdict,
      winnerUid: disputerUid,
      gameUpdate: {
        lastResolvedDisputeTurnNumber: game.turnNumber,
        status: "complete",
        winner: disputerUid,
        p1Letters,
        p2Letters,
        reviewFor: null,
        reviewDeadline: null,
        appendTurnRecord: turnRecord,
      },
      statDeltas,
    };
  }

  // Setter keeps setting: currentSetter unchanged, they set the next trick.
  return {
    verdict,
    winnerUid: null,
    gameUpdate: {
      lastResolvedDisputeTurnNumber: game.turnNumber,
      phase: "setting",
      currentSetter: disputerUid,
      currentTurn: disputerUid,
      turnNumber: game.turnNumber + 1,
      turnDeadlineMs: nowMs + TURN_DURATION_MS,
      p1Letters,
      p2Letters,
      reviewFor: null,
      reviewDeadline: null,
      appendTurnRecord: turnRecord,
    },
    statDeltas,
  };
}

/**
 * Decide the `pendingReview` expiry auto-accept — the deferred honor swap.
 *
 * When the opponent lets the 24h accept/dispute window lapse without disputing,
 * the matcher's "landed" claim stands and the game continues exactly as today's
 * honor landed resolution, just deferred (§3.3). NO stats are written: no
 * dispute was ever raised, so none of the four counters move. Kept alongside
 * the vote resolution so both timed transitions share one source of truth.
 *
 * Pure decision math; the caller gates eligibility (phase === pendingReview,
 * deadline passed).
 */
export function decidePendingReviewExpiry(game: GameDoc, nowMs: number): DisputeGameUpdate {
  const matcherUid = game.reviewFor ?? opponentOf(game, game.currentSetter);
  return honorSwapUpdate(game, matcherUid, nowMs);
}
