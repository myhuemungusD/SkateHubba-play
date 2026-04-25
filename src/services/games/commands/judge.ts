import { doc, runTransaction, serverTimestamp, Timestamp } from "firebase/firestore";
import { requireDb } from "../../../firebase";
import { writeNotificationInTx } from "../../notifications";
import { toGameDoc } from "../../games.mappers";
import { TURN_DURATION_MS, getOpponent, checkTurnActionRate, recordTurnAction } from "../../games.turns";

/* ────────────────────────────────────────────
 * Judge invite lifecycle
 *
 * Judge nomination is OPTIONAL — a game can be played on the honor system
 * with no judge at all. When a judge is nominated, the invite stays in
 * `pending` until the judge accepts, declines, or the 24h window elapses.
 *
 * While pending: game operates as honor system (no dispute / no BS calls)
 * Accepted:      dispute & BS flows route to the judge
 * Declined:      permanent honor system (judgeId preserved for history,
 *                judgeStatus flipped so rules know not to route to them)
 * ──────────────────────────────────────────── */

/**
 * Accept a pending referee invite. Must be called by the nominated referee;
 * rejects if the game is over, has no referee, or the invite is no longer
 * pending (already accepted / declined / 24h expired).
 */
export async function acceptJudgeInvite(gameId: string): Promise<void> {
  const gameRef = doc(requireDb(), "games", gameId);
  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");
    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (!game.judgeId) throw new Error("No referee was nominated for this game");
    if (game.judgeStatus !== "pending") throw new Error("Referee invite is no longer pending");

    tx.update(gameRef, {
      judgeStatus: "accepted",
      updatedAt: serverTimestamp(),
    });
  });
}

/**
 * Decline a pending referee invite. The game continues on the honor system;
 * `judgeId` is preserved for history but `judgeStatus` flips to `declined`
 * so BS / dispute flows route back to honor-system behavior.
 */
export async function declineJudgeInvite(gameId: string): Promise<void> {
  const gameRef = doc(requireDb(), "games", gameId);
  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");
    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (!game.judgeId) throw new Error("No referee was nominated for this game");
    if (game.judgeStatus !== "pending") throw new Error("Referee invite is no longer pending");

    tx.update(gameRef, {
      judgeStatus: "declined",
      updatedAt: serverTimestamp(),
    });
  });
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
