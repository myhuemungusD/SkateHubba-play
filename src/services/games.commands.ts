import { doc, setDoc, runTransaction, serverTimestamp, Timestamp, arrayUnion } from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { parseFirebaseError } from "../utils/helpers";
import { analytics } from "./analytics";
import { logger, metrics } from "./logger";
import { writeNotification, writeNotificationInTx } from "./notifications";
import { writeLandedClipsInTransaction } from "./clips";
import {
  toGameDoc,
  isJudgeActive,
  normalizeSpotId,
  type TurnRecord,
  type GameStatus,
  type GamePhase,
  type JudgeStatus,
  type CreateGameOptions,
} from "./games.mappers";
import {
  TURN_DURATION_MS,
  gamesRef,
  getOpponent,
  checkGameCreationRate,
  recordGameCreation,
  checkTurnActionRate,
  recordTurnAction,
} from "./games.turns";

/* ────────────────────────────────────────────
 * Create a new game (challenge)
 * ──────────────────────────────────────────── */

/**
 * Create a new SKATE game between two players. Returns the new game ID.
 *
 * Preconditions / throws:
 *   • caller must be `challengerUid` (enforced by Firestore rules)
 *   • challenger email must be verified (rules)
 *   • rate limited: one game per `GAME_CREATE_COOLDOWN_MS` per client
 *   • if `judgeUid` is supplied, `judgeUsername` MUST also be supplied and
 *     `judgeUid` MUST differ from both players
 *
 * The challenger is assigned as `player1` and sets first.
 */
export async function createGame(
  challengerUid: string,
  challengerUsername: string,
  opponentUid: string,
  opponentUsername: string,
  options: CreateGameOptions = {},
): Promise<string> {
  checkGameCreationRate();

  const { challengerIsVerifiedPro, opponentIsVerifiedPro, spotId, judgeUid, judgeUsername } = options;

  // Defense-in-depth: drop any spotId that doesn't look like a UUID before
  // it reaches Firestore. Keeps the data model clean even if an upstream
  // caller forgets to validate or a shared URL has a stale/garbled value.
  const safeSpotId = normalizeSpotId(spotId);

  // Judge validation: if a judge is nominated, they must be a distinct third
  // party. Silently dropping an invalid nomination lets the game fall back to
  // honor system rather than rejecting the whole creation — UI-level guards
  // surface the "can't judge yourself / your opponent" message upstream.
  const hasValidJudge =
    typeof judgeUid === "string" &&
    judgeUid.length > 0 &&
    judgeUid !== challengerUid &&
    judgeUid !== opponentUid &&
    typeof judgeUsername === "string" &&
    judgeUsername.length > 0;

  const deadline = Timestamp.fromMillis(Date.now() + TURN_DURATION_MS);

  const gameData = {
    player1Uid: challengerUid,
    player2Uid: opponentUid,
    player1Username: challengerUsername,
    player2Username: opponentUsername,
    p1Letters: 0,
    p2Letters: 0,
    status: "active" as GameStatus,
    // Challenger sets first trick
    currentTurn: challengerUid,
    phase: "setting" as GamePhase,
    currentSetter: challengerUid,
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnDeadline: deadline,
    turnNumber: 1,
    winner: null,
    turnHistory: [],
    // Judge fields default to null (honor system). Keeping explicit nulls —
    // rather than omitting — makes security rule checks easier and keeps
    // the schema uniform across all game docs.
    judgeId: hasValidJudge ? judgeUid : null,
    judgeUsername: hasValidJudge ? judgeUsername : null,
    judgeStatus: (hasValidJudge ? "pending" : null) as JudgeStatus,
    judgeReviewFor: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...(challengerIsVerifiedPro && { player1IsVerifiedPro: true }),
    ...(opponentIsVerifiedPro && { player2IsVerifiedPro: true }),
    ...(safeSpotId && { spotId: safeSpotId }),
  };

  // Generate the game ID client-side so a retry after a perceived network
  // failure re-sends the exact same write (idempotent at a fixed ID) instead
  // of creating a second game. addDoc would be non-deterministic here.
  const newGameId = doc(gamesRef()).id;
  await withRetry(() => setDoc(doc(gamesRef(), newGameId), gameData));
  recordGameCreation();
  metrics.gameCreated(newGameId, challengerUid);
  // Update rate-limit timestamp on user profile (best effort — game is already created).
  setDoc(doc(requireDb(), "users", challengerUid), { lastGameCreatedAt: serverTimestamp() }, { merge: true }).catch(
    (err) => {
      logger.warn("rate_limit_timestamp_write_failed", {
        uid: challengerUid,
        error: parseFirebaseError(err),
      });
    },
  );
  // Notify opponent about the new challenge (best-effort). createGame is not
  // transactional, so this stays outside — the only perceivable race is a
  // missed toast if the tab dies in the narrow window between the two writes.
  writeNotification({
    senderUid: challengerUid,
    recipientUid: opponentUid,
    type: "new_challenge",
    title: "New Challenge!",
    body: `@${challengerUsername} challenged you to S.K.A.T.E.`,
    gameId: newGameId,
  });
  // Notify the referee (if any) that they've been nominated (best-effort).
  // The notification `type` code stays "judge_invite" for schema stability —
  // existing docs and any listeners keyed on it must keep working. Only the
  // user-visible title copy is renamed.
  if (hasValidJudge) {
    writeNotification({
      senderUid: challengerUid,
      recipientUid: judgeUid,
      type: "judge_invite",
      title: "You've been asked to referee",
      body: `@${challengerUsername} vs @${opponentUsername} — accept to rule on disputes`,
      gameId: newGameId,
    });
  }
  return newGameId;
}

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
