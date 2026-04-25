import { doc, runTransaction, serverTimestamp, Timestamp } from "firebase/firestore";
import { requireDb } from "../../../firebase";
import { analytics } from "../../analytics";
import { metrics } from "../../logger";
import { writeNotificationInTx } from "../../notifications";
import { toGameDoc, isJudgeActive } from "../../games.mappers";
import { TURN_DURATION_MS, getOpponent, checkTurnActionRate, recordTurnAction } from "../../games.turns";

/* ────────────────────────────────────────────
 * Set a trick (setter's turn)
 * ──────────────────────────────────────────── */

export async function setTrick(gameId: string, trickName: string, videoUrl: string | null): Promise<void> {
  // Sanitise at the service boundary: trim whitespace, strip control chars, cap length
  const safeTrickName = trickName
    .trim()
    // eslint-disable-next-line no-control-regex -- intentionally stripping C0/C1 control characters
    .replace(/[\x00-\x1F\x7F]/g, "")
    .slice(0, 100);
  if (!safeTrickName) throw new Error("Trick name cannot be empty");

  checkTurnActionRate(gameId);
  const gameRef = doc(requireDb(), "games", gameId);

  // Firestore transactions have built-in retry for transient conflicts;
  // withRetry is not needed here and would incorrectly retry app-logic errors.
  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");

    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (game.phase !== "setting") throw new Error("Not in setting phase");

    const matcherUid = getOpponent(game, game.currentSetter);
    const setterUsername = game.currentSetter === game.player1Uid ? game.player1Username : game.player2Username;

    tx.update(gameRef, {
      phase: "matching",
      currentTrickName: safeTrickName,
      currentTrickVideoUrl: videoUrl,
      matchVideoUrl: null,
      currentTurn: matcherUid,
      turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
      updatedAt: serverTimestamp(),
    });

    // Notify matcher it's their turn — atomically with the game update.
    writeNotificationInTx(tx, {
      senderUid: game.currentSetter,
      recipientUid: matcherUid,
      type: "your_turn",
      title: "Your Turn!",
      body: `Match @${setterUsername}'s ${safeTrickName}`,
      gameId,
    });
  });
  recordTurnAction(gameId);
  metrics.trickSet(gameId, safeTrickName, videoUrl !== null);
  analytics.trickSet(gameId, safeTrickName);
}

/* ────────────────────────────────────────────
 * Setter failed to land their trick — turn passes
 * ──────────────────────────────────────────── */

export async function failSetTrick(gameId: string): Promise<void> {
  checkTurnActionRate(gameId);
  const gameRef = doc(requireDb(), "games", gameId);

  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");

    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (game.phase !== "setting") throw new Error("Not in setting phase");

    const nextSetter = getOpponent(game, game.currentSetter);
    const prevSetterUsername = game.currentSetter === game.player1Uid ? game.player1Username : game.player2Username;

    tx.update(gameRef, {
      phase: "setting",
      currentSetter: nextSetter,
      currentTurn: nextSetter,
      currentTrickName: null,
      currentTrickVideoUrl: null,
      matchVideoUrl: null,
      turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
      turnNumber: game.turnNumber + 1,
      updatedAt: serverTimestamp(),
    });

    // Notify next setter it's their turn — atomically with the game update.
    writeNotificationInTx(tx, {
      senderUid: game.currentSetter,
      recipientUid: nextSetter,
      type: "your_turn",
      title: "Your Turn to Set!",
      body: `@${prevSetterUsername} couldn't land their trick. Set a trick!`,
      gameId,
    });
  });
  recordTurnAction(gameId);
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
