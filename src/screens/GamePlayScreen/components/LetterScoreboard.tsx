import { LetterDisplay } from "../../../components/LetterDisplay";
import type { GameDoc } from "../../../services/games";
import type { UserProfile } from "../../../services/users";

interface Props {
  game: GameDoc;
  viewerIsJudge: boolean;
  profile: UserProfile;
  myLetters: number;
  theirLetters: number;
  opponentName: string;
  opponentIsPro: boolean | undefined;
  /** Who must act right now; null while the call sits with a referee or the community. */
  acting: "me" | "them" | null;
  /** Shown on the viewer's card when the body has no countdown of its own. */
  deadline?: number;
}

/**
 * Two score cards. The card of the player who must act is the lit one, with
 * the turn label and the clock on it (the chess.com player-bar pattern), so
 * "is it my move?" is answered at a glance.
 */
export function LetterScoreboard({
  game,
  viewerIsJudge,
  profile,
  myLetters,
  theirLetters,
  opponentName,
  opponentIsPro,
  acting,
  deadline,
}: Props) {
  if (viewerIsJudge) {
    const actingUid =
      game.phase === "setting" ? game.currentSetter : game.phase === "matching" ? game.currentTurn : null;
    return (
      <div className="flex justify-center gap-5 mb-6">
        <LetterDisplay
          count={game.p1Letters}
          name={`@${game.player1Username}`}
          active={actingUid === game.player1Uid}
          turnLabel="ON THE CLOCK"
          isVerifiedPro={game.player1IsVerifiedPro}
        />
        <div className="flex items-center font-display text-2xl text-subtle">VS</div>
        <LetterDisplay
          count={game.p2Letters}
          name={`@${game.player2Username}`}
          active={actingUid === game.player2Uid}
          turnLabel="ON THE CLOCK"
          isVerifiedPro={game.player2IsVerifiedPro}
        />
      </div>
    );
  }

  return (
    <div className="flex justify-center gap-5 mb-6">
      <LetterDisplay
        count={myLetters}
        name={`@${profile.username}`}
        testId={`letter-display-${profile.username}`}
        active={acting === "me"}
        turnLabel="YOUR MOVE"
        deadline={deadline}
        isVerifiedPro={profile.isVerifiedPro}
      />
      <div className="flex items-center font-display text-2xl text-subtle">VS</div>
      <LetterDisplay
        count={theirLetters}
        name={`@${opponentName}`}
        testId={`letter-display-${opponentName}`}
        active={acting === "them"}
        turnLabel="THEIR MOVE"
        isVerifiedPro={opponentIsPro}
      />
    </div>
  );
}
