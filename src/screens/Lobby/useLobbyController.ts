import { useCallback, type FocusEvent, type KeyboardEvent } from "react";
import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";

function isGameExpired(g: GameDoc): boolean {
  const deadline = g.turnDeadline?.toMillis?.() ?? 0;
  return deadline > 0 && deadline <= Date.now();
}

interface Args {
  profile: UserProfile;
  games: GameDoc[];
}

/** Win/loss tally behind the one-line completed summary. Judge-only games
 *  count toward `total` but not toward W/L — the viewer never played them. */
export interface CompletedSummary {
  total: number;
  wins: number;
  losses: number;
}

export interface LobbyController {
  /** Games awaiting the viewer's move, most urgent (soonest deadline) first. */
  myTurn: GameDoc[];
  /** Every other active game — waiting on the opponent, a referee, or expiry. */
  theirTurn: GameDoc[];
  completedSummary: CompletedSummary;

  isJudge: (g: GameDoc) => boolean;
  isPlayer: (g: GameDoc) => boolean;
  opponent: (g: GameDoc) => string;
  opponentUid: (g: GameDoc) => string;
  opponentIsVerifiedPro: (g: GameDoc) => boolean | undefined;
  isMyTurn: (g: GameDoc) => boolean;
  myLetters: (g: GameDoc) => number;
  theirLetters: (g: GameDoc) => number;
  turnLabel: (g: GameDoc) => string;

  cardButtonProps: (handler: () => void) => {
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
    onKeyUp: (e: KeyboardEvent<HTMLElement>) => void;
    onBlur: (e: FocusEvent<HTMLElement>) => void;
  };
}

export function useLobbyController({ profile, games }: Args): LobbyController {
  const active = games.filter((g) => g.status === "active");
  const done = games.filter((g) => g.status !== "active");

  const isJudge = useCallback((g: GameDoc) => !!g.judgeId && g.judgeId === profile.uid, [profile.uid]);
  const isPlayer = useCallback(
    (g: GameDoc) => g.player1Uid === profile.uid || g.player2Uid === profile.uid,
    [profile.uid],
  );
  const opponent = useCallback(
    (g: GameDoc) => (g.player1Uid === profile.uid ? g.player2Username : g.player1Username),
    [profile.uid],
  );
  const opponentUid = useCallback(
    (g: GameDoc) => (g.player1Uid === profile.uid ? g.player2Uid : g.player1Uid),
    [profile.uid],
  );
  const opponentIsVerifiedPro = useCallback(
    (g: GameDoc) => (g.player1Uid === profile.uid ? g.player2IsVerifiedPro : g.player1IsVerifiedPro),
    [profile.uid],
  );
  const isMyTurn = useCallback((g: GameDoc) => g.currentTurn === profile.uid, [profile.uid]);
  const myLetters = useCallback(
    (g: GameDoc) => (g.player1Uid === profile.uid ? g.p1Letters : g.p2Letters),
    [profile.uid],
  );
  const theirLetters = useCallback(
    (g: GameDoc) => (g.player1Uid === profile.uid ? g.p2Letters : g.p1Letters),
    [profile.uid],
  );

  const turnLabel = useCallback(
    (g: GameDoc) => {
      const trick = g.currentTrickName || "Trick";
      // An expired deadline freezes the game for everyone until the
      // auto-forfeit sweep lands (GameContext dispatches forfeitExpiredTurn
      // from the games snapshot), so guard first — same order as
      // isActionableTurn below — or the branches after this would still claim
      // it's someone's turn. The outcome depends on the phase (forfeit,
      // dispute auto-accepted, set auto-cleared), so the label only says the
      // clock ran out, split by which side let it run out.
      if (isGameExpired(g)) return isMyTurn(g) ? "Your time ran out — resolving" : "Their time ran out — resolving";
      if (isJudge(g) && !isPlayer(g)) {
        if (isMyTurn(g)) {
          if (g.phase === "disputable") return "Rule: landed or missed?";
          if (g.phase === "setReview") return "Rule: clean or sketchy?";
        }
        if (g.phase === "disputable" || g.phase === "setReview") return "Awaiting your ruling";
        if (g.phase === "matching") return `Matching: ${trick}`;
        return "Setting a trick";
      }
      if (g.phase === "disputable" || g.phase === "setReview") {
        return g.judgeUsername ? `Referee @${g.judgeUsername} reviewing` : "Under review";
      }
      // Binding community dispute (honor-system): the game is frozen on a
      // landed claim. currentTurn still points at the matcher, so guard these
      // before the isMyTurn branch below to avoid a misleading "Your turn".
      if (g.phase === "communityReview") return "Under community review";
      if (g.phase === "pendingReview") {
        return g.currentSetter === profile.uid ? "Review their landed claim" : "Under review";
      }
      if (isMyTurn(g)) {
        if (g.phase === "matching") return `Match: ${trick}`;
        return "Your turn to set";
      }
      if (g.phase === "matching") return `Matching: ${trick}`;
      return "They're setting a trick";
    },
    [isJudge, isPlayer, isMyTurn, profile.uid],
  );

  // Whether the viewer can actually move on this game right now. Mirrors the
  // guard order in turnLabel above: a referee only acts in the review phases,
  // review/community phases freeze the players, and an expired turn is waiting
  // on the auto-forfeit sweep, not on the viewer.
  const isActionableTurn = useCallback(
    (g: GameDoc) => {
      if (isGameExpired(g)) return false;
      if (isJudge(g) && !isPlayer(g)) return isMyTurn(g) && (g.phase === "disputable" || g.phase === "setReview");
      if (g.phase === "disputable" || g.phase === "setReview" || g.phase === "communityReview") return false;
      if (g.phase === "pendingReview") return g.currentSetter === profile.uid;
      return isMyTurn(g);
    },
    [isJudge, isPlayer, isMyTurn, profile.uid],
  );

  // Games with no deadline sort last so a live countdown always outranks them.
  const deadlineRank = (g: GameDoc): number => {
    const ms = g.turnDeadline?.toMillis?.() ?? 0;
    return ms > 0 ? ms : Number.POSITIVE_INFINITY;
  };

  const myTurn = active.filter(isActionableTurn).sort((a, b) => deadlineRank(a) - deadlineRank(b));
  const theirTurn = active.filter((g) => !isActionableTurn(g));

  const completedSummary: CompletedSummary = {
    total: done.length,
    wins: done.filter((g) => isPlayer(g) && g.winner === profile.uid).length,
    losses: done.filter((g) => isPlayer(g) && !!g.winner && g.winner !== profile.uid).length,
  };

  const cardButtonProps = useCallback(
    (handler: () => void) => ({
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        if (e.repeat) return;
        if (e.key === "Enter") {
          e.preventDefault();
          handler();
        } else if (e.key === " ") {
          e.preventDefault();
          e.currentTarget.dataset.spacePrimed = "true";
        }
      },
      onKeyUp: (e: KeyboardEvent<HTMLElement>) => {
        if (e.key === " " && e.currentTarget.dataset.spacePrimed === "true") {
          delete e.currentTarget.dataset.spacePrimed;
          e.preventDefault();
          handler();
        }
      },
      onBlur: (e: FocusEvent<HTMLElement>) => {
        delete e.currentTarget.dataset.spacePrimed;
      },
    }),
    [],
  );

  return {
    myTurn,
    theirTurn,
    completedSummary,
    isJudge,
    isPlayer,
    opponent,
    opponentUid,
    opponentIsVerifiedPro,
    isMyTurn,
    myLetters,
    theirLetters,
    turnLabel,
    cardButtonProps,
  };
}
