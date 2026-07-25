/**
 * Derives the feed's "ruling" lane from the games the viewer already
 * subscribes to.
 *
 * The lobby's game subscription (`subscribeToUserGames`) merges three
 * slices — player1, player2, and judge — so every game awaiting the viewer's
 * ruling is ALREADY in the `games` array the Lobby holds. Selecting the
 * ruling lane from that array costs zero extra Firestore reads and stays
 * live through the existing onSnapshot listeners; a dedicated query would
 * duplicate reads and drift from the game state the rest of the lobby shows.
 */

import { isJudgeActive, type GameDoc } from "../../services/games";

/**
 * A dispute awaiting this viewer's ruling.
 *
 *  • kind 'dispute'  — phase `disputable`: the matcher claims they landed the
 *    setter's trick. Judge rules LANDED (accept) or MISSED (reject).
 *  • kind 'setReview' — phase `setReview`: the matcher called BS on the set
 *    itself. Judge rules CLEAN (set stands) or SKETCHY (setter re-sets).
 */
export interface PendingRuling {
  gameId: string;
  kind: "dispute" | "setReview";
  trickName: string;
  setterUsername: string;
  matcherUsername: string;
  setVideoUrl: string | null;
  /** Always null for a setReview — the matcher hasn't attempted yet. */
  matchVideoUrl: string | null;
  /** Turn deadline in epoch millis; drives the "expires in" copy. */
  deadlineMs: number;
}

function usernamesFor(game: GameDoc): { setter: string; matcher: string } {
  const setterIsP1 = game.currentSetter === game.player1Uid;
  return {
    setter: setterIsP1 ? game.player1Username : game.player2Username,
    matcher: setterIsP1 ? game.player2Username : game.player1Username,
  };
}

/**
 * Select the games this viewer must rule on, soonest deadline first.
 *
 * A game qualifies only when every judging precondition the service layer
 * enforces is already true, so a card can never render a ruling the
 * transaction would reject:
 *   • game is still active
 *   • viewer is the nominated judge AND the invite was accepted
 *     (`isJudgeActive` — a pending or declined judge rules on nothing)
 *   • phase is `disputable` or `setReview`
 *   • `currentTurn` routes to the viewer — the same guard the game screen
 *     uses, so a ruling already cast elsewhere drops out of the lane on the
 *     next snapshot
 *
 * Expired turns are excluded: once `turnDeadline` passes, the forfeit sweep
 * owns the turn and a ruling written against it would race that path.
 */
export function selectPendingRulings(games: readonly GameDoc[], viewerUid: string, nowMs: number): PendingRuling[] {
  const pending: PendingRuling[] = [];

  for (const game of games) {
    if (game.status !== "active") continue;
    if (game.judgeId !== viewerUid || !isJudgeActive(game)) continue;
    if (game.currentTurn !== viewerUid) continue;
    if (game.phase !== "disputable" && game.phase !== "setReview") continue;

    const deadlineMs = game.turnDeadline?.toMillis?.() ?? 0;
    if (deadlineMs > 0 && deadlineMs <= nowMs) continue;

    const { setter, matcher } = usernamesFor(game);
    pending.push({
      gameId: game.id,
      kind: game.phase === "disputable" ? "dispute" : "setReview",
      trickName: game.currentTrickName || "Trick",
      setterUsername: setter,
      matcherUsername: matcher,
      setVideoUrl: game.currentTrickVideoUrl,
      // In setReview the matcher is disputing the SET, so there is no attempt
      // video to show even if a stale one lingers on the doc from a prior turn.
      matchVideoUrl: game.phase === "disputable" ? game.matchVideoUrl : null,
      deadlineMs,
    });
  }

  // Soonest deadline first — the ruling most at risk of expiring is the one
  // worth showing first. Games without a deadline sort last.
  return pending.sort((a, b) => (a.deadlineMs || Infinity) - (b.deadlineMs || Infinity));
}
