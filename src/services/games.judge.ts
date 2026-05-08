import { doc, runTransaction, serverTimestamp, Timestamp, arrayUnion } from "firebase/firestore";
import { requireDb } from "../firebase";
import { analytics } from "./analytics";
import { metrics } from "./logger";
import { writeNotificationInTx } from "./notifications";
import { writeLandedClipsInTransaction } from "./clips";
import { toGameDoc, isJudgeActive, type GameDoc, type TurnRecord } from "./games.mappers";
import { TURN_DURATION_MS, getOpponent, checkTurnActionRate, recordTurnAction } from "./games.turns";
import { applyGameOutcome } from "./users";

/**
 * Count how many tricks `uid` has landed during `game` (matcher-side
 * landed turns in `turnHistory`). Used as `tricksLandedThisGame`
 * telemetry context on the terminal stats writes.
 */
function tricksLandedForUid(game: GameDoc, uid: string): number {
  return (game.turnHistory ?? []).filter((t) => t.landed && t.matcherUid === uid).length;
}

/* ────────────────────────────────────────────
 * Matcher calls BS on the setter's trick (judge-only feature)
 *
 * Requires:
 *   • game in `matching` phase
 *   • caller is the matcher
 *   • judge is active (accepted)
 *
 * Effect: phase → setReview, currentTurn routes to judge. Judge rules
 * clean (set stands, matcher must attempt) or sketchy (setter re-sets).
 * 24h timeout → clean (benefit of the doubt to setter).
 * ──────────────────────────────────────────── */

export async function callBSOnSetTrick(gameId: string): Promise<void> {
  checkTurnActionRate(gameId);
  const gameRef = doc(requireDb(), "games", gameId);

  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");

    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (game.phase !== "matching") throw new Error("Not in matching phase");
    if (!isJudgeActive(game) || !game.judgeId) {
      throw new Error("Call BS is only available when a referee is active");
    }

    const matcherUid = getOpponent(game, game.currentSetter);
    const setterUsername = game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username;
    const matcherUsernameVal = game.player1Uid === game.currentSetter ? game.player2Username : game.player1Username;

    tx.update(gameRef, {
      phase: "setReview",
      currentTurn: game.judgeId, // judge rules on the set trick
      judgeReviewFor: game.currentSetter,
      turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
      updatedAt: serverTimestamp(),
    });

    // Notify the judge atomically with the game update.
    writeNotificationInTx(tx, {
      senderUid: matcherUid,
      recipientUid: game.judgeId,
      type: "your_turn",
      title: "Ruling Needed",
      body: `@${matcherUsernameVal} called BS on @${setterUsername}'s set. Rule clean or sketchy?`,
      gameId,
    });
  });
  recordTurnAction(gameId);
}

/* ────────────────────────────────────────────
 * Judge rules on a "Call BS" in the setReview phase.
 *
 *   clean=true   → set stands, matcher must attempt (phase=matching)
 *   clean=false  → setter re-sets (phase=setting, same setter, cleared trick)
 * ──────────────────────────────────────────── */

export async function judgeRuleSetTrick(gameId: string, clean: boolean): Promise<void> {
  checkTurnActionRate(gameId);
  const gameRef = doc(requireDb(), "games", gameId);

  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");

    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (game.phase !== "setReview") throw new Error("Not in setReview phase");
    if (!game.judgeId) throw new Error("No referee on this game");

    const matcherUid = getOpponent(game, game.currentSetter);
    const setterUsername = game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username;
    const matcherUsernameVal = game.player1Uid === game.currentSetter ? game.player2Username : game.player1Username;

    if (clean) {
      // Set stands — matcher has to attempt. Return to matching phase.
      tx.update(gameRef, {
        phase: "matching",
        currentTurn: matcherUid,
        judgeReviewFor: null,
        turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
        updatedAt: serverTimestamp(),
      });

      // Matcher must now attempt the (judged-clean) trick.
      writeNotificationInTx(tx, {
        senderUid: game.currentSetter,
        recipientUid: matcherUid,
        type: "your_turn",
        title: "Referee ruled: Clean",
        body: `The set stands. Match @${setterUsername}'s trick.`,
        gameId,
      });
    } else {
      // Setter must re-set. Clear the trick fields and stay on the same setter.
      tx.update(gameRef, {
        phase: "setting",
        currentTurn: game.currentSetter,
        currentTrickName: null,
        currentTrickVideoUrl: null,
        matchVideoUrl: null,
        judgeReviewFor: null,
        turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
        updatedAt: serverTimestamp(),
      });

      // Setter has to re-set.
      writeNotificationInTx(tx, {
        senderUid: matcherUid,
        recipientUid: game.currentSetter,
        type: "your_turn",
        title: "Referee ruled: Sketchy",
        body: `Set a new trick for @${matcherUsernameVal}.`,
        gameId,
      });
    }
  });
  recordTurnAction(gameId);
}

/* ────────────────────────────────────────────
 * Resolve a disputable turn (judge rules on matcher's "landed" claim)
 *
 * Only the judge can call this. The setter never self-judges — disputes
 * only exist in games with an active judge.
 *
 *   accept=true  → matcher's "landed" call stands, roles swap
 *   accept=false → judge overrules, matcher gets a letter
 * ──────────────────────────────────────────── */

export async function resolveDispute(
  gameId: string,
  accept: boolean,
): Promise<{ gameOver: boolean; winner: string | null }> {
  checkTurnActionRate(gameId);
  const gameRef = doc(requireDb(), "games", gameId);

  const result = await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");

    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (game.phase !== "disputable") throw new Error("Not in disputable phase");
    if (!game.judgeId) throw new Error("No referee on this game");

    const matcherUid = getOpponent(game, game.currentSetter);
    const setterUsername = game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username;
    const matcherUsernameVal = game.player1Uid === game.currentSetter ? game.player2Username : game.player1Username;

    const isP1Matcher = matcherUid === game.player1Uid;
    let newP1Letters = game.p1Letters;
    let newP2Letters = game.p2Letters;

    const landed = accept; // accept = matcher landed; dispute = matcher missed

    if (!landed) {
      if (isP1Matcher) newP1Letters++;
      else newP2Letters++;
    }

    const gameOver = newP1Letters >= 5 || newP2Letters >= 5;
    const winner = gameOver ? (newP1Letters >= 5 ? game.player2Uid : game.player1Uid) : null;
    const nextSetter = landed ? matcherUid : game.currentSetter;

    const turnRecord: TurnRecord = {
      turnNumber: game.turnNumber,
      trickName: game.currentTrickName || "Trick",
      setterUid: game.currentSetter,
      setterUsername,
      matcherUid,
      matcherUsername: matcherUsernameVal,
      setVideoUrl: game.currentTrickVideoUrl,
      matchVideoUrl: game.matchVideoUrl,
      landed,
      letterTo: landed ? null : matcherUid,
      judgedBy: game.judgeId,
    };

    const updates: Record<string, unknown> = {
      turnHistory: arrayUnion(turnRecord),
      p1Letters: newP1Letters,
      p2Letters: newP2Letters,
      judgeReviewFor: null,
      updatedAt: serverTimestamp(),
    };

    if (gameOver) {
      updates.status = "complete";
      updates.winner = winner;
    } else {
      updates.phase = "setting";
      updates.currentSetter = nextSetter;
      updates.currentTurn = nextSetter;
      updates.turnDeadline = Timestamp.fromMillis(Date.now() + TURN_DURATION_MS);
      updates.turnNumber = game.turnNumber + 1;
    }

    tx.update(gameRef, updates);

    // PR-A1: terminal disputed game → stage stats writes for both players.
    // No clean-judgment credit — disputes never qualify per plan §3.1.1
    // (rule: "no `disputes` doc filed for that turn"). In the dispute
    // path, only the matcher can earn a letter, so when the game ends
    // the SETTER is always the winner and the MATCHER is always the
    // loser — matches the existing in-tx notification logic above.
    if (gameOver && winner) {
      const setterTricks = tricksLandedForUid(game, game.currentSetter);
      const matcherTricks = tricksLandedForUid(game, matcherUid);
      await applyGameOutcome(
        tx,
        game.currentSetter,
        gameId,
        { result: "win", tricksLandedThisGame: setterTricks, cleanJudgmentEarned: false },
        0,
      );
      await applyGameOutcome(
        tx,
        matcherUid,
        gameId,
        { result: "loss", tricksLandedThisGame: matcherTricks, cleanJudgmentEarned: false },
        0,
      );
    }

    // Set clip always enters the feed here (setter's set was landed). Match
    // clip only if the judge upheld the matcher's "landed" call.
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
      matcherLanded: landed,
      spotId: game.spotId ?? null,
    });

    // Notify the matcher atomically — sender is the judge, not a player.
    // In dispute resolution, only the matcher can gain a letter, so the
    // setter is always the winner when the game ends.
    if (gameOver) {
      writeNotificationInTx(tx, {
        senderUid: game.judgeId,
        recipientUid: matcherUid,
        type: "game_lost",
        title: "Game Over",
        body: `vs @${setterUsername}`,
        gameId,
      });
    } else if (landed) {
      writeNotificationInTx(tx, {
        senderUid: game.judgeId,
        recipientUid: matcherUid,
        type: "your_turn",
        title: "Referee ruled: Landed",
        body: `You landed! Set a trick for @${setterUsername}`,
        gameId,
      });
    } else {
      writeNotificationInTx(tx, {
        senderUid: game.judgeId,
        recipientUid: matcherUid,
        type: "your_turn",
        title: "Referee ruled: Missed",
        body: `Set a trick for @${matcherUsernameVal}`,
        gameId,
      });
    }

    return {
      gameOver,
      winner,
      landed,
      matcherUid,
      turnNumber: game.turnNumber,
    };
  });
  recordTurnAction(gameId);

  if (result.gameOver && result.winner) {
    metrics.gameCompleted(gameId, result.winner, result.turnNumber);
    analytics.gameCompleted(gameId, result.winner === result.matcherUid);
  }

  return { gameOver: result.gameOver, winner: result.winner };
}
