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
  isSetter: boolean;
  isMatcher: boolean;
}

export function LetterScoreboard({
  game,
  viewerIsJudge,
  profile,
  myLetters,
  theirLetters,
  opponentName,
  opponentIsPro,
  isSetter,
  isMatcher,
}: Props) {
  if (viewerIsJudge) {
    return (
      <div className="flex justify-center gap-5 mb-6">
        <LetterDisplay
          count={game.p1Letters}
          name={`@${game.player1Username}`}
          active={game.currentSetter === game.player1Uid && game.phase === "setting"}
          isVerifiedPro={game.player1IsVerifiedPro}
        />
        <div className="flex items-center font-display text-2xl text-subtle">VS</div>
        <LetterDisplay
          count={game.p2Letters}
          name={`@${game.player2Username}`}
          active={game.currentSetter === game.player2Uid && game.phase === "setting"}
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
        active={isSetter}
        isVerifiedPro={profile.isVerifiedPro}
      />
      <div className="flex items-center font-display text-2xl text-subtle">VS</div>
      <LetterDisplay
        count={theirLetters}
        name={`@${opponentName}`}
        testId={`letter-display-${opponentName}`}
        active={isMatcher}
        isVerifiedPro={opponentIsPro}
      />
    </div>
  );
}
