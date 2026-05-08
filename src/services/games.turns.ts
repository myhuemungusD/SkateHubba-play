import { collection, doc, runTransaction, serverTimestamp, Timestamp, arrayUnion } from "firebase/firestore";
import { requireDb } from "../firebase";
import { metrics } from "./logger";
import { writeLandedClipsInTransaction } from "./clips";
import { toGameDoc, type GameDoc, type TurnRecord } from "./games.mappers";
import { applyGameOutcome } from "./users";

/**
 * Per-user matcher-landed turn count — used as `tricksLandedThisGame`
 * telemetry on the terminal stats writes from forfeitExpiredTurn.
 */
function tricksLandedForUid(game: GameDoc, uid: string): number {
  return (game.turnHistory ?? []).filter((t) => t.landed && t.matcherUid === uid).length;
}

export const TURN_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

export function gamesRef() {
  return collection(requireDb(), "games");
}

export function getOpponent(game: GameDoc, playerUid: string): string {
  return playerUid === game.player1Uid ? game.player2Uid : game.player1Uid;
}

/* ────────────────────────────────────────────
 * Client-side rate limiting (defense-in-depth)
 * ──────────────────────────────────────────── */

// Game creation: one per 10 seconds globally
let lastGameCreatedAt = 0;
const GAME_CREATE_COOLDOWN_MS = 10_000;

// Turn actions (setTrick, failSetTrick, submitMatchAttempt): one per 3 seconds per game
const lastTurnActionAt = new Map<string, number>();
const TURN_ACTION_COOLDOWN_MS = 3_000;

export function checkGameCreationRate(): void {
  if (Date.now() - lastGameCreatedAt < GAME_CREATE_COOLDOWN_MS) {
    throw new Error("Please wait before creating another game");
  }
}

export function recordGameCreation(): void {
  lastGameCreatedAt = Date.now();
}

export function checkTurnActionRate(gameId: string): void {
  const last = lastTurnActionAt.get(gameId) ?? 0;
  if (Date.now() - last < TURN_ACTION_COOLDOWN_MS) {
    throw new Error("Please wait before submitting another action");
  }
}

export function recordTurnAction(gameId: string): void {
  const now = Date.now();
  lastTurnActionAt.set(gameId, now);
  // Drop entries past the cooldown window so the map stays bounded by
  // concurrently-active games, not an arbitrary size threshold.
  const cutoff = now - TURN_ACTION_COOLDOWN_MS;
  for (const [id, ts] of lastTurnActionAt) {
    if (ts < cutoff) lastTurnActionAt.delete(id);
  }
}

/** @internal Reset rate-limit state (for tests only) */
export function _resetCreateGameRateLimit() {
  lastGameCreatedAt = 0;
  lastTurnActionAt.clear();
}

/** @internal Inspect the turn-action rate-limit map size (for tests only) */
export function _turnActionMapSize(): number {
  return lastTurnActionAt.size;
}

/**
 * Advance the game when the current turn's deadline has passed.
 *
 * Safe to call speculatively: returns `{ forfeited: false }` when the game
 * is over, the deadline hasn't passed, or no turn is active. Any client
 * observing an expired turn should call this — Firestore rules ensure only
 * a legal transition is written.
 *
 * Expiration branches:
 *   • `setting` / `matching`  → active player forfeits (opponent wins)
 *   • `disputable`            → matcher's "landed" call auto-accepted
 *   • `setReview`             → setter's trick auto-ruled clean
 */
export async function forfeitExpiredTurn(gameId: string): Promise<{
  forfeited: boolean;
  winner: string | null;
  disputeAutoAccepted?: boolean;
  /** True when an expired setReview was auto-ruled clean (set stands). */
  setReviewAutoCleared?: boolean;
}> {
  const gameRef = doc(requireDb(), "games", gameId);

  return runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) return { forfeited: false, winner: null };

    const game = toGameDoc(snap);
    if (game.status !== "active") return { forfeited: false, winner: null };

    const deadline = game.turnDeadline?.toMillis?.() ?? 0;
    if (deadline === 0 || Date.now() < deadline) {
      return { forfeited: false, winner: null };
    }

    // ── Disputable phase expired → auto-accept matcher's "landed" call ──
    if (game.phase === "disputable") {
      const matcherUid = getOpponent(game, game.currentSetter);
      const setterUsername = game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username;
      const matcherUsernameVal = game.player1Uid === game.currentSetter ? game.player2Username : game.player1Username;

      // Roles swap: matcher (who landed) becomes next setter
      const nextSetter = matcherUid;

      const turnRecord: TurnRecord = {
        turnNumber: game.turnNumber,
        trickName: game.currentTrickName || "Trick",
        setterUid: game.currentSetter,
        setterUsername,
        matcherUid,
        matcherUsername: matcherUsernameVal,
        setVideoUrl: game.currentTrickVideoUrl,
        matchVideoUrl: game.matchVideoUrl,
        landed: true,
        letterTo: null,
        judgedBy: null, // auto-accept, no judge ruled explicitly
      };

      tx.update(gameRef, {
        phase: "setting",
        currentSetter: nextSetter,
        currentTurn: nextSetter,
        turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
        turnNumber: game.turnNumber + 1,
        turnHistory: arrayUnion(turnRecord),
        p1Letters: game.p1Letters,
        p2Letters: game.p2Letters,
        judgeReviewFor: null,
        updatedAt: serverTimestamp(),
      });

      // Auto-accept: matcher's landed call stands, so both set and match are
      // confirmed landed clips for the feed.
      writeLandedClipsInTransaction(tx, {
        gameId,
        turnNumber: game.turnNumber,
        trickName: game.currentTrickName || "Trick",
        setterUid: game.currentSetter,
        setterUsername,
        matcherUid,
        matcherUsername: matcherUsernameVal,
        setVideoUrl: game.currentTrickVideoUrl,
        matchVideoUrl: game.matchVideoUrl,
        matcherLanded: true,
        spotId: game.spotId ?? null,
      });

      return { forfeited: false, winner: null, disputeAutoAccepted: true };
    }

    // ── setReview phase expired → benefit of doubt to setter (set stands) ──
    if (game.phase === "setReview") {
      const matcherUid = getOpponent(game, game.currentSetter);
      tx.update(gameRef, {
        phase: "matching",
        currentTurn: matcherUid,
        judgeReviewFor: null,
        turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
        updatedAt: serverTimestamp(),
      });
      return { forfeited: false, winner: null, setReviewAutoCleared: true };
    }

    // ── Normal forfeit (setting / matching) ──────────────────
    const winner = getOpponent(game, game.currentTurn);
    const forfeiter = game.currentTurn;

    tx.update(gameRef, {
      status: "forfeit",
      winner,
      updatedAt: serverTimestamp(),
    });

    // PR-A1: stage stats writes — forfeiter's gamesForfeited+1 (streak
    // resets per §3.1.2), opponent's gamesWon+1. Idempotent + flag-gated.
    const forfeiterTricks = tricksLandedForUid(game, forfeiter);
    const winnerTricks = tricksLandedForUid(game, winner);
    await applyGameOutcome(
      tx,
      forfeiter,
      gameId,
      { result: "forfeit", tricksLandedThisGame: forfeiterTricks, cleanJudgmentEarned: false },
      0,
    );
    await applyGameOutcome(
      tx,
      winner,
      gameId,
      { result: "win", tricksLandedThisGame: winnerTricks, cleanJudgmentEarned: false },
      0,
    );

    metrics.gameForfeit(gameId, winner);
    return { forfeited: true, winner };
  });
}
