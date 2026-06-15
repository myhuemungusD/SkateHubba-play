/**
 * SDK-agnostic forfeit decision logic.
 *
 * This module contains ZERO Firebase imports. It is the single source of truth
 * for "what happens when the current turn's deadline passes", shared by:
 *
 *   • the client transactional wrapper `forfeitExpiredTurn` (games.turns.ts),
 *     which runs in a player's browser via the Firebase web SDK, and
 *   • the server "auto-referee" cron sweep (api/cron/sweep-expired-turns.ts),
 *     which runs on Vercel via the firebase-admin SDK.
 *
 * Both callers feed in a plain `GameDoc` plus `nowMs` and translate the
 * returned decision into their respective SDK's write objects. Because the
 * branching, role math, letter assignment and TurnRecord shape all live here,
 * the two paths can never diverge — game-state outcomes are byte-identical.
 *
 * The helper is intentionally pure: no I/O, no clock reads (the caller passes
 * `nowMs`), no Timestamp construction (callers turn `*Ms` numbers into their
 * SDK's Timestamp). This keeps it unit-testable in isolation and reusable
 * across both SDKs.
 */

import { TURN_DURATION_MS } from "./turnDuration";
import type { GameDoc, TurnRecord } from "./games.mappers";

/** The opponent of `playerUid` in a two-player game. Mirrors getOpponent. */
function opponentOf(game: GameDoc, playerUid: string): string {
  return playerUid === game.player1Uid ? game.player2Uid : game.player1Uid;
}

/**
 * The kind of transition an expired turn triggers.
 *
 *  • "forfeit"          — active player ran out the clock; opponent wins.
 *  • "disputeAccept"    — disputable phase expired; matcher's "landed" stands.
 *  • "setReviewClear"   — setReview expired; setter gets benefit of the doubt.
 */
export type ForfeitKind = "forfeit" | "disputeAccept" | "setReviewClear";

/**
 * Fields the caller must write onto the game doc, with all *Ms values left as
 * plain numbers so each SDK can build its own Timestamp / serverTimestamp.
 * `updatedAt` is intentionally omitted — callers always stamp it with their
 * SDK's serverTimestamp().
 */
export interface ForfeitGameUpdate {
  status?: GameDoc["status"];
  winner?: string;
  phase?: GameDoc["phase"];
  currentSetter?: string;
  currentTurn?: string;
  /** Epoch ms for the new turn deadline; caller converts to a Timestamp. */
  turnDeadlineMs?: number;
  turnNumber?: number;
  p1Letters?: number;
  p2Letters?: number;
  judgeReviewFor?: null;
  /** TurnRecord to append via the SDK's arrayUnion. Absent when none. */
  appendTurnRecord?: TurnRecord;
}

/**
 * Context for the landed-clip write that accompanies a disputeAccept. Mirrors
 * `LandedClipContext` but is reproduced here to keep this module free of any
 * clips/firebase dependency. Present only for the disputeAccept branch.
 */
export interface ForfeitLandedClips {
  gameId: string;
  turnNumber: number;
  trickName: string;
  setterUid: string;
  setterUsername: string;
  matcherUid: string;
  matcherUsername: string;
  setVideoUrl: string | null;
  matchVideoUrl: string | null;
  matcherLanded: boolean;
  spotId: string | null;
}

/**
 * "Your turn" notification side-effect that accompanies a turn-advancing
 * resolution (disputeAccept + setReviewClear). `null` for the terminal forfeit
 * branch (the game ends — nobody's turn is next).
 *
 * This is a SIDE-EFFECT descriptor, NOT part of the game-state write. Both SDK
 * paths read the SAME `notification` value, but they MATERIALIZE it differently:
 *   • Server sweep (admin SDK) ALWAYS writes it — the recipient is the away
 *     player and admin bypasses firestore.rules.
 *   • Client (web SDK) writes it ONLY when the recipient is not the caller,
 *     because the /notifications create rule forbids self-notify
 *     (senderUid == auth.uid AND recipientUid != auth.uid). The game-state
 *     write is identical regardless — only this side-effect is conditional.
 */
export interface ForfeitNotification {
  /** Player to alert that it's now their turn. */
  recipientUid: string;
  /** Notification author — the player whose inaction triggered the resolution. */
  senderUid: string;
  type: "your_turn";
  title: string;
  body: string;
}

export interface ForfeitDecision {
  kind: ForfeitKind;
  /** Winner UID for a terminal forfeit; null for the non-terminal branches. */
  winnerUid: string | null;
  /** Loser UID for a terminal forfeit; null otherwise. */
  loserUid: string | null;
  /** Field writes to apply to the game doc. */
  gameUpdate: ForfeitGameUpdate;
  /** Landed-clip context to write (disputeAccept only). */
  landedClips: ForfeitLandedClips | null;
  /**
   * "Your turn" notification for the turn-advancing branches; `null` for plain
   * forfeit. Identical across both SDK paths — the client may conditionally
   * skip EMITTING it (self-notify rule), but the decision value itself is the
   * same regardless of caller.
   */
  notification: ForfeitNotification | null;
}

/**
 * Decide what an expired turn does, or return `null` when nothing should
 * happen. Returning `null` is the idempotent / not-eligible signal:
 *
 *   • game is not active (already complete/forfeit) → null
 *   • no deadline set, or the deadline has not yet passed → null
 *
 * The `gameId` is required only to populate the landed-clip context for the
 * disputeAccept branch; the other branches ignore it.
 */
export function decideExpiredForfeit(game: GameDoc, nowMs: number, gameId: string): ForfeitDecision | null {
  if (game.status !== "active") return null;

  const deadline = game.turnDeadline?.toMillis?.() ?? 0;
  if (deadline === 0 || nowMs < deadline) return null;

  const newDeadlineMs = nowMs + TURN_DURATION_MS;

  // ── Disputable phase expired → auto-accept matcher's "landed" call ──
  if (game.phase === "disputable") {
    const matcherUid = opponentOf(game, game.currentSetter);
    const setterUsername = game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username;
    const matcherUsernameVal = game.player1Uid === game.currentSetter ? game.player2Username : game.player1Username;
    const trickName = game.currentTrickName || "Trick";

    // Roles swap: matcher (who landed) becomes next setter.
    const nextSetter = matcherUid;

    const turnRecord: TurnRecord = {
      turnNumber: game.turnNumber,
      trickName,
      setterUid: game.currentSetter,
      setterUsername,
      matcherUid,
      matcherUsername: matcherUsernameVal,
      setVideoUrl: game.currentTrickVideoUrl,
      matchVideoUrl: game.matchVideoUrl,
      landed: true,
      letterTo: null,
      judgedBy: null,
    };

    return {
      kind: "disputeAccept",
      winnerUid: null,
      loserUid: null,
      gameUpdate: {
        phase: "setting",
        currentSetter: nextSetter,
        currentTurn: nextSetter,
        turnDeadlineMs: newDeadlineMs,
        turnNumber: game.turnNumber + 1,
        p1Letters: game.p1Letters,
        p2Letters: game.p2Letters,
        judgeReviewFor: null,
        appendTurnRecord: turnRecord,
      },
      landedClips: {
        gameId,
        turnNumber: game.turnNumber,
        trickName,
        setterUid: game.currentSetter,
        setterUsername,
        matcherUid,
        matcherUsername: matcherUsernameVal,
        setVideoUrl: game.currentTrickVideoUrl,
        matchVideoUrl: game.matchVideoUrl,
        matcherLanded: true,
        spotId: game.spotId ?? null,
      },
      // Roles swapped: the matcher who landed becomes the next setter. Alert
      // them it's their turn. Sender is the prior setter whose expired dispute
      // window triggered the auto-accept.
      notification: {
        recipientUid: nextSetter,
        senderUid: game.currentSetter,
        type: "your_turn",
        title: "Your Turn to Set!",
        body: `You landed @${setterUsername}'s ${trickName}. Set a trick!`,
      },
    };
  }

  // ── setReview phase expired → benefit of doubt to setter (set stands) ──
  if (game.phase === "setReview") {
    const matcherUid = opponentOf(game, game.currentSetter);
    const setterUsername = game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username;
    const trickName = game.currentTrickName || "Trick";
    return {
      kind: "setReviewClear",
      winnerUid: null,
      loserUid: null,
      gameUpdate: {
        phase: "matching",
        currentTurn: matcherUid,
        judgeReviewFor: null,
        turnDeadlineMs: newDeadlineMs,
      },
      landedClips: null,
      // The set stood; the matcher is now on the clock. Alert them it's their
      // turn. Sender is the setter, whose unreviewed trick was ruled clean.
      notification: {
        recipientUid: matcherUid,
        senderUid: game.currentSetter,
        type: "your_turn",
        title: "Your Turn!",
        body: `Match @${setterUsername}'s ${trickName}`,
      },
    };
  }

  // ── Normal forfeit (setting / matching) ──────────────────
  const winner = opponentOf(game, game.currentTurn);

  // Append a final turn record so consumers walking turnHistory can render
  // the "how it ended" frame. Mirrors the disputable/setReview branches which
  // also append, keeping the history strip uniform across all end states.
  const setterUid = game.currentSetter;
  const matcherUid = opponentOf(game, setterUid);
  const setterUsername = game.player1Uid === setterUid ? game.player1Username : game.player2Username;
  const matcherUsername = game.player1Uid === setterUid ? game.player2Username : game.player1Username;
  const turnRecord: TurnRecord = {
    turnNumber: game.turnNumber,
    trickName: game.currentTrickName || "Trick",
    setterUid,
    setterUsername,
    matcherUid,
    matcherUsername,
    setVideoUrl: game.currentTrickVideoUrl,
    matchVideoUrl: game.matchVideoUrl,
    landed: false,
    // The forfeited player (whose turn it was) is the loser — record that they
    // took the letter ending the game.
    letterTo: game.currentTurn,
    judgedBy: null,
  };

  return {
    kind: "forfeit",
    winnerUid: winner,
    loserUid: game.currentTurn,
    gameUpdate: {
      status: "forfeit",
      winner,
      appendTurnRecord: turnRecord,
    },
    landedClips: null,
    // Game ends here — nobody's turn is next, so no "your turn" notification.
    notification: null,
  };
}
