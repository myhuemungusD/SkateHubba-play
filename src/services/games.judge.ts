import { serverTimestamp, Timestamp, arrayUnion } from "firebase/firestore";
import { analytics } from "./analytics";
import { metrics } from "./logger";
import { writeNotificationInTx } from "./notifications";
import { writeLandedClipsInTransaction } from "./clips";
import { isJudgeActive, type TurnRecord } from "./games.mappers";
import { applyRoundOutcome, getOpponent, runActiveGameTurn } from "./games.turns";
import { turnDurationMsFor } from "./turnDuration";
import { clearedTrickFields, trickSnapshot } from "./trickFields";
import { applyTrainingLabelPending } from "./trainingLabels.materialize";

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
 * Turn-length timeout (24h default) → clean (benefit of the doubt to setter).
 * ──────────────────────────────────────────── */

export async function callBSOnSetTrick(gameId: string): Promise<void> {
  await runActiveGameTurn(gameId, async ({ tx, gameRef, game, pushOutbox }) => {
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
      turnDeadline: Timestamp.fromMillis(Date.now() + turnDurationMsFor(game)),
      updatedAt: serverTimestamp(),
    });

    // Notify the judge atomically with the game update.
    writeNotificationInTx(
      tx,
      {
        senderUid: matcherUid,
        recipientUid: game.judgeId,
        type: "your_turn",
        title: "Ruling Needed",
        body: `@${matcherUsernameVal} called BS on @${setterUsername}'s set. Rule clean or sketchy?`,
        gameId,
      },
      pushOutbox,
    );
  });
}

/* ────────────────────────────────────────────
 * Judge rules on a "Call BS" in the setReview phase.
 *
 *   clean=true   → set stands, matcher must attempt (phase=matching)
 *   clean=false  → setter re-sets (phase=setting, same setter, cleared trick)
 * ──────────────────────────────────────────── */

export async function judgeRuleSetTrick(gameId: string, clean: boolean): Promise<void> {
  await runActiveGameTurn(gameId, async ({ tx, gameRef, game, pushOutbox }) => {
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
        turnDeadline: Timestamp.fromMillis(Date.now() + turnDurationMsFor(game)),
        updatedAt: serverTimestamp(),
      });

      // Matcher must now attempt the (judged-clean) trick.
      writeNotificationInTx(
        tx,
        {
          senderUid: game.currentSetter,
          recipientUid: matcherUid,
          type: "your_turn",
          title: "Referee ruled: Clean",
          body: `The set stands. Match @${setterUsername}'s trick.`,
          gameId,
        },
        pushOutbox,
      );
    } else {
      // Setter must re-set. Clear the trick fields and stay on the same setter.
      tx.update(gameRef, {
        phase: "setting",
        currentTurn: game.currentSetter,
        currentTrickName: null,
        ...clearedTrickFields(),
        currentTrickVideoUrl: null,
        matchVideoUrl: null,
        judgeReviewFor: null,
        turnDeadline: Timestamp.fromMillis(Date.now() + turnDurationMsFor(game)),
        updatedAt: serverTimestamp(),
      });

      // Setter has to re-set.
      writeNotificationInTx(
        tx,
        {
          senderUid: matcherUid,
          recipientUid: game.currentSetter,
          type: "your_turn",
          title: "Referee ruled: Sketchy",
          body: `Set a new trick for @${matcherUsernameVal}.`,
          gameId,
        },
        pushOutbox,
      );
    }
  });
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
  const result = await runActiveGameTurn(gameId, async ({ tx, gameRef, game, pushOutbox }) => {
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
      ...trickSnapshot(game),
    };

    const updates: Record<string, unknown> = {
      turnHistory: arrayUnion(turnRecord),
      p1Letters: newP1Letters,
      p2Letters: newP2Letters,
      judgeReviewFor: null,
      updatedAt: serverTimestamp(),
    };
    applyTrainingLabelPending(updates, turnRecord);

    applyRoundOutcome(updates, game, { gameOver, winner, nextSetter });

    tx.update(gameRef, updates);

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
      writeNotificationInTx(
        tx,
        {
          senderUid: game.judgeId,
          recipientUid: matcherUid,
          type: "game_lost",
          title: "Game Over",
          body: `vs @${setterUsername}`,
          gameId,
        },
        pushOutbox,
      );
    } else if (landed) {
      writeNotificationInTx(
        tx,
        {
          senderUid: game.judgeId,
          recipientUid: matcherUid,
          type: "your_turn",
          title: "Referee ruled: Landed",
          body: `You landed! Set a trick for @${setterUsername}`,
          gameId,
        },
        pushOutbox,
      );
    } else {
      writeNotificationInTx(
        tx,
        {
          senderUid: game.judgeId,
          recipientUid: matcherUid,
          type: "your_turn",
          title: "Referee ruled: Missed",
          body: `Set a trick for @${matcherUsernameVal}`,
          gameId,
        },
        pushOutbox,
      );
    }

    return {
      gameOver,
      winner,
      landed,
      matcherUid,
      turnNumber: game.turnNumber,
    };
  });

  if (result.gameOver && result.winner) {
    metrics.gameCompleted(gameId, result.winner, result.turnNumber);
    analytics.gameCompleted(gameId, result.winner === result.matcherUid);
  }

  return { gameOver: result.gameOver, winner: result.winner };
}
