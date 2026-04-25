import { doc, runTransaction, serverTimestamp, Timestamp, arrayUnion } from "firebase/firestore";
import { requireDb } from "../../../firebase";
import { analytics } from "../../analytics";
import { metrics } from "../../logger";
import { writeNotificationInTx } from "../../notifications";
import { writeLandedClipsInTransaction } from "../../clips";
import { toGameDoc, isJudgeActive, type TurnRecord } from "../../games.mappers";
import { TURN_DURATION_MS, getOpponent, checkTurnActionRate, recordTurnAction } from "../../games.turns";

/* ────────────────────────────────────────────
 * Submit match attempt (matcher self-judges)
 *
 * Honor system (no active judge):
 *   • landed  → matcher's call stands, roles swap, turn advances
 *   • missed  → matcher gains a letter, setter keeps setting
 *
 * With active judge:
 *   • landed  → "disputable" phase; judge has 24h to rule (auto-accept after)
 *   • missed  → letter applied immediately (matcher admitting a miss is never
 *               disputed — they lose by calling themselves out)
 * ──────────────────────────────────────────── */

export async function submitMatchAttempt(
  gameId: string,
  matchVideoUrl: string | null,
  landed: boolean,
): Promise<{ gameOver: boolean; winner: string | null }> {
  checkTurnActionRate(gameId);
  const gameRef = doc(requireDb(), "games", gameId);

  const result = await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error("Game not found");

    const game = toGameDoc(snap);
    if (game.status !== "active") throw new Error("Game is already over");
    if (game.phase !== "matching") throw new Error("Not in matching phase");

    const matcherUid = getOpponent(game, game.currentSetter);
    const setterUsername = game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username;
    const matcherUsernameVal = game.player1Uid === game.currentSetter ? game.player2Username : game.player1Username;
    const judgeActive = isJudgeActive(game);

    // ── Matcher claims LANDED ─────────────────────────────────
    if (landed) {
      // With an active judge → route to disputable for judge review
      if (judgeActive && game.judgeId) {
        tx.update(gameRef, {
          phase: "disputable",
          matchVideoUrl,
          currentTurn: game.judgeId, // judge reviews, never the setter
          judgeReviewFor: matcherUid,
          turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
          updatedAt: serverTimestamp(),
        });

        // Notify the judge — atomically with the game update.
        writeNotificationInTx(tx, {
          senderUid: matcherUid,
          recipientUid: game.judgeId,
          type: "your_turn",
          title: "Ruling Needed",
          body: `@${matcherUsernameVal} claims they landed @${setterUsername}'s trick. Rule landed or missed?`,
          gameId,
        });

        return {
          outcome: "disputable" as const,
          gameOver: false,
          winner: null,
          setterUid: game.currentSetter,
          matcherUid,
          setterUsername,
          matcherUsername: matcherUsernameVal,
          judgeUid: game.judgeId,
          nextSetter: game.currentSetter,
          turnNumber: game.turnNumber,
        };
      }

      // Honor system → matcher's call stands immediately, roles swap.
      const nextSetter = matcherUid;
      const turnRecord: TurnRecord = {
        turnNumber: game.turnNumber,
        trickName: game.currentTrickName || "Trick",
        setterUid: game.currentSetter,
        setterUsername,
        matcherUid,
        matcherUsername: matcherUsernameVal,
        setVideoUrl: game.currentTrickVideoUrl,
        matchVideoUrl,
        landed: true,
        letterTo: null,
        judgedBy: null,
      };

      tx.update(gameRef, {
        matchVideoUrl,
        phase: "setting",
        currentSetter: nextSetter,
        currentTurn: nextSetter,
        turnDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
        turnNumber: game.turnNumber + 1,
        turnHistory: arrayUnion(turnRecord),
        p1Letters: game.p1Letters,
        p2Letters: game.p2Letters,
        updatedAt: serverTimestamp(),
      });

      // Denormalize into the clips feed. Honor-system landed → both set and
      // match are confirmed landed clips.
      writeLandedClipsInTransaction(tx, {
        gameId,
        turnNumber: game.turnNumber,
        trickName: game.currentTrickName || "Trick",
        setterUid: game.currentSetter,
        setterUsername,
        matcherUid,
        matcherUsername: matcherUsernameVal,
        setVideoUrl: game.currentTrickVideoUrl,
        matchVideoUrl,
        matcherLanded: true,
        spotId: game.spotId ?? null,
      });

      // Honor-system landed: previous setter is next matcher — let them know.
      writeNotificationInTx(tx, {
        senderUid: matcherUid,
        recipientUid: game.currentSetter,
        type: "your_turn",
        title: "Trick Landed!",
        body: `@${matcherUsernameVal} landed your trick. Your turn to match.`,
        gameId,
      });

      return {
        outcome: "landed_honor" as const,
        gameOver: false,
        winner: null,
        setterUid: game.currentSetter,
        matcherUid,
        setterUsername,
        matcherUsername: matcherUsernameVal,
        nextSetter,
        turnNumber: game.turnNumber,
      };
    }

    // ── Matcher admits MISSED → immediate resolution (both paths) ──
    const isP1Matcher = matcherUid === game.player1Uid;
    let newP1Letters = game.p1Letters;
    let newP2Letters = game.p2Letters;

    if (isP1Matcher) newP1Letters++;
    else newP2Letters++;

    const gameOver = newP1Letters >= 5 || newP2Letters >= 5;
    const winner = gameOver ? (newP1Letters >= 5 ? game.player2Uid : game.player1Uid) : null;
    const nextSetter = game.currentSetter;

    const turnRecord: TurnRecord = {
      turnNumber: game.turnNumber,
      trickName: game.currentTrickName || "Trick",
      setterUid: game.currentSetter,
      setterUsername,
      matcherUid,
      matcherUsername: matcherUsernameVal,
      setVideoUrl: game.currentTrickVideoUrl,
      matchVideoUrl,
      landed: false,
      letterTo: matcherUid,
      judgedBy: null,
    };

    const updates: Record<string, unknown> = {
      matchVideoUrl,
      turnHistory: arrayUnion(turnRecord),
      p1Letters: newP1Letters,
      p2Letters: newP2Letters,
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

    // Set clip still enters the feed — the setter landed their set trick
    // (failed sets never reach this code path). The missed match attempt
    // is intentionally excluded.
    writeLandedClipsInTransaction(tx, {
      gameId,
      turnNumber: game.turnNumber,
      trickName: game.currentTrickName || "Trick",
      setterUid: game.currentSetter,
      setterUsername,
      matcherUid,
      matcherUsername: matcherUsernameVal,
      setVideoUrl: game.currentTrickVideoUrl,
      matchVideoUrl,
      matcherLanded: false,
      spotId: game.spotId ?? null,
    });

    // Notify the setter atomically. In the missed path, only the matcher
    // gains a letter, so the setter always wins when the game ends here.
    if (gameOver) {
      writeNotificationInTx(tx, {
        senderUid: matcherUid,
        recipientUid: game.currentSetter,
        type: "game_won",
        title: "You Won!",
        body: `vs @${matcherUsernameVal}`,
        gameId,
      });
    } else {
      writeNotificationInTx(tx, {
        senderUid: matcherUid,
        recipientUid: nextSetter,
        type: "your_turn",
        title: "Your Turn to Set!",
        body: `Set a trick for @${matcherUsernameVal}`,
        gameId,
      });
    }

    return {
      outcome: "missed" as const,
      gameOver,
      winner,
      setterUid: game.currentSetter,
      matcherUid,
      setterUsername,
      matcherUsername: matcherUsernameVal,
      nextSetter,
      turnNumber: game.turnNumber,
    };
  });
  recordTurnAction(gameId);
  metrics.matchSubmitted(gameId, landed);
  analytics.matchSubmitted(gameId, landed);

  // Missed path — game may be over here. Notifications were staged in-tx.
  if (result.gameOver && result.winner) {
    metrics.gameCompleted(gameId, result.winner, result.turnNumber);
    analytics.gameCompleted(gameId, result.winner === result.matcherUid);
  }

  return { gameOver: result.gameOver, winner: result.winner };
}
