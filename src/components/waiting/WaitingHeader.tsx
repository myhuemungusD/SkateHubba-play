import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";
import { LetterDisplay } from "../LetterDisplay";
import { Timer } from "../Timer";
import { HourglassIcon } from "../icons";

interface WaitingHeaderProps {
  game: GameDoc;
  profile: UserProfile;
  isJudge: boolean;
  myLetters: number;
  theirLetters: number;
  opponentName: string;
  opponentIsPro: boolean | undefined;
  activePlayerUsername: string;
  waitingOnLabel: string;
  deadline: number;
}

export function WaitingHeader({
  game,
  profile,
  isJudge,
  myLetters,
  theirLetters,
  opponentName,
  opponentIsPro,
  activePlayerUsername,
  waitingOnLabel,
  deadline,
}: WaitingHeaderProps) {
  return (
    <>
      <div className="flex justify-center gap-5 mb-4">
        {isJudge ? (
          <>
            <LetterDisplay
              count={game.p1Letters}
              name={`@${game.player1Username}`}
              active={game.currentTurn === game.player1Uid}
              isVerifiedPro={game.player1IsVerifiedPro}
            />
            <div className="flex items-center font-display text-2xl text-subtle">VS</div>
            <LetterDisplay
              count={game.p2Letters}
              name={`@${game.player2Username}`}
              active={game.currentTurn === game.player2Uid}
              isVerifiedPro={game.player2IsVerifiedPro}
            />
          </>
        ) : (
          <>
            <LetterDisplay
              count={myLetters}
              name={`@${profile.username}`}
              testId={`letter-display-${profile.username}`}
              active={false}
              isVerifiedPro={profile.isVerifiedPro}
            />
            <div className="flex items-center font-display text-2xl text-subtle">VS</div>
            <LetterDisplay
              count={theirLetters}
              name={`@${opponentName}`}
              testId={`letter-display-${opponentName}`}
              active={false}
              isVerifiedPro={opponentIsPro}
            />
          </>
        )}
      </div>

      <div className="flex justify-center mb-4">
        <HourglassIcon size={48} className="text-subtle" />
      </div>
      <h2 className="font-display text-fluid-2xl text-white mb-2">Waiting on {waitingOnLabel}</h2>
      {game.judgeUsername && game.judgeStatus === "pending" && (
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-subtle/40 bg-white/[0.03] px-3 py-1 text-[11px] text-subtle">
          <span className="font-display tracking-wider">REFEREE PENDING</span>
          <span className="font-body">@{game.judgeUsername} hasn&apos;t responded — honor system applies</span>
        </div>
      )}
      {game.judgeUsername && game.judgeStatus === "accepted" && (
        <div
          className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-orange/30 bg-brand-orange/[0.06] px-3 py-1 text-[11px] text-brand-orange"
          data-testid="judge-active-badge"
        >
          <span className="font-display tracking-wider">REFEREE</span>
          <span className="font-body">@{game.judgeUsername} rules disputes</span>
        </div>
      )}
      {game.judgeUsername && game.judgeStatus === "declined" && (
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-subtle/40 bg-white/[0.03] px-3 py-1 text-[11px] text-subtle">
          <span className="font-display tracking-wider">NO REFEREE</span>
          <span className="font-body">Honor system — no disputes</span>
        </div>
      )}
      <p className="font-body text-sm text-muted mb-2">
        {game.phase === "disputable"
          ? game.judgeUsername
            ? `Referee is reviewing the match call.`
            : "They're reviewing your match attempt."
          : game.phase === "setReview"
            ? `Referee is ruling clean or sketchy on the set.`
            : game.phase === "setting"
              ? isJudge
                ? `@${activePlayerUsername} is setting a trick.`
                : "They're setting a trick for you to match."
              : isJudge
                ? `@${activePlayerUsername} is attempting the match.`
                : "They're attempting to match your trick."}
      </p>
      <Timer deadline={deadline} />
    </>
  );
}
