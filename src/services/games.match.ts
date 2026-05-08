import { doc, runTransaction, serverTimestamp, Timestamp, arrayUnion } from "firebase/firestore";
import { requireDb } from "../firebase";
import { analytics } from "./analytics";
import { metrics } from "./logger";
import { writeNotificationInTx } from "./notifications";
import { writeLandedClipsInTransaction } from "./clips";
import { toGameDoc, isJudgeActive, type GameDoc, type TurnRecord } from "./games.mappers";
import { TURN_DURATION_MS, getOpponent, checkTurnActionRate, recordTurnAction } from "./games.turns";
import { applyGameOutcome, applyTrickLanded } from "./users";

/**
 * Count how many tricks `uid` has landed during `game` (strictly: how
 * many turns in `turnHistory` they were the matcher on AND landed).
 * Used as input to `applyGameOutcome` for telemetry context — the
 * actual counter writes are owned by `applyTrickLanded` per turn.
 */
function tricksLandedForUid(game: GameDoc, uid: string): number {
  return (game.turnHistory ?? []).filter((t) => t.landed && t.matcherUid === uid).length;
}

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

    // matchVideoUrl is intentionally NOT written here — the setting-phase
    // rule (firestore.rules) pins it immutable, so writing null after a
    // prior turn left a real URL on the doc would be permission-denied.
    // Nothing reads game.matchVideoUrl during the next turn's setting/
    // matching phases (UI sources from currentTrickVideoUrl + turnHistory).
    tx.update(gameRef, {
      phase: "matching",
      currentTrickName: safeTrickName,
      currentTrickVideoUrl: videoUrl,
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

    // matchVideoUrl intentionally omitted — see setTrick above.
    tx.update(gameRef, {
      phase: "setting",
      currentSetter: nextSetter,
      currentTurn: nextSetter,
      currentTrickName: null,
      currentTrickVideoUrl: null,
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

      // PR-A1: increment matcher's tricksLanded counter inside the same tx.
      // applyTrickLanded refuses past 6/game (anti-grinding cap §3.1.3) and
      // is feature-flag gated — no-op while `feature.stats_counters_v2` is
      // off in production rollout.
      await applyTrickLanded(tx, matcherUid, gameId);

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

    // PR-A1: terminal-miss → stage stats counter writes for both players
    // inside the same tx. In the missed-attempt code path, only the
    // matcher can earn a letter, so the SETTER is always the winner and
    // the MATCHER is always the loser when the game ends here. The setter
    // earns cleanJudgmentEarned because matcher admitted miss without a
    // dispute (no judge involvement on this code path — judge-active games
    // route through resolveDispute instead).
    if (gameOver) {
      const setterTricks = tricksLandedForUid(game, game.currentSetter);
      const matcherTricks = tricksLandedForUid(game, matcherUid);
      await applyGameOutcome(
        tx,
        game.currentSetter,
        gameId,
        { result: "win", tricksLandedThisGame: setterTricks, cleanJudgmentEarned: true },
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
