import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { VideoRecorder } from "../../components/VideoRecorder";
import { TurnHistoryViewer } from "../../components/TurnHistoryViewer";
import { WaitingScreen } from "../../components/WaitingScreen";
import { ReportModal } from "../../components/ReportModal";
import { useGamePlayController } from "./useGamePlayController";
import { JudgeStatusBadge } from "./components/JudgeStatusBadge";
import { DisputeReviewPanel } from "./components/DisputeReviewPanel";
import { SetTrickReviewPanel } from "./components/SetTrickReviewPanel";
import { JudgeInviteCard } from "./components/JudgeInviteCard";
import { GamePlayHeader } from "./components/GamePlayHeader";
import { LetterScoreboard } from "./components/LetterScoreboard";
import { SetterTrickInput } from "./components/SetterTrickInput";
import { MatcherInstructionBanner } from "./components/MatcherInstructionBanner";
import { MatcherTrickViewer } from "./components/MatcherTrickViewer";
import { SetterDecisionPanel } from "./components/SetterDecisionPanel";
import { MatcherDecisionPanel } from "./components/MatcherDecisionPanel";

export function GamePlayScreen({ game, profile, onBack }: { game: GameDoc; profile: UserProfile; onBack: () => void }) {
  const c = useGamePlayController(game, profile);

  if (!c.isSetter && !c.isMatcher && !c.isDisputeReviewer && !c.isSetTrickReviewer && !c.isJudgeInvitePending) {
    return <WaitingScreen game={game} profile={profile} onBack={onBack} />;
  }

  return (
    <div className="min-h-dvh bg-background/80 pb-10">
      <GamePlayHeader
        deadline={c.deadline}
        isPlayer={c.isPlayer}
        reported={c.reported}
        onBack={onBack}
        onReport={c.openReport}
      />

      <div className="px-5 pt-5 max-w-md mx-auto">
        <JudgeStatusBadge game={game} viewerIsJudge={c.isJudge} />

        <LetterScoreboard
          game={game}
          viewerIsJudge={c.isJudge}
          profile={profile}
          myLetters={c.myLetters}
          theirLetters={c.theirLetters}
          opponentName={c.opponentName}
          opponentIsPro={c.opponentIsPro}
          isSetter={c.isSetter}
          isMatcher={c.isMatcher}
        />

        {!c.isJudge && c.isSetter && (
          <SetterTrickInput
            trickName={c.trickName}
            setTrickName={c.setTrickName}
            videoRecorded={c.videoRecorded}
            showRecorder={c.showRecorder}
            trimmedTrickName={c.trimmedTrickName}
          />
        )}
        {!c.isJudge && !c.isSetter && c.isMatcher && (
          <MatcherInstructionBanner
            setterUsername={c.setterUsername}
            setterIsPro={c.setterIsPro}
            currentTrickName={game.currentTrickName}
          />
        )}

        {c.isMatcher && (
          <MatcherTrickViewer
            game={game}
            setterUsername={c.setterUsername}
            setterIsPro={c.setterIsPro}
            judgeActive={c.judgeActive}
            videoRecorded={c.videoRecorded}
            callBSSubmitting={c.callBSSubmitting}
            error={c.error}
            onCallBS={c.handleCallBS}
          />
        )}

        {!c.isJudge && (c.isSetter || c.isMatcher) && c.showRecorder && (
          <VideoRecorder
            onRecorded={c.handleRecorded}
            label={c.isSetter ? "Land Your Trick" : `Match the ${game.currentTrickName || "Trick"}`}
            autoOpen={c.isSetter}
            doneLabel="Recorded"
          />
        )}

        <ErrorBanner message={c.error} onDismiss={c.dismissError} />

        {c.isSetter && (
          <SetterDecisionPanel
            videoBlob={c.videoBlob}
            videoRecorded={c.videoRecorded}
            submitting={c.submitting}
            error={c.error}
            uploadProgress={c.uploadProgress}
            setterAction={c.setterAction}
            opponentName={c.opponentName}
            submitSetterTrick={c.submitSetterTrick}
            submitSetterMissed={c.submitSetterMissed}
          />
        )}

        {c.isMatcher && (
          <MatcherDecisionPanel
            videoRecorded={c.videoRecorded}
            submitting={c.submitting}
            error={c.error}
            uploadProgress={c.uploadProgress}
            matcherLanded={c.matcherLanded}
            submitMatchWithCall={c.submitMatchWithCall}
          />
        )}

        {c.isDisputeReviewer && (
          <DisputeReviewPanel
            game={game}
            setterUsername={c.setterUsername}
            matcherUsername={c.matcherUsername}
            disputeSubmitting={c.disputeSubmitting}
            lastDisputeAction={c.lastDisputeAction}
            error={c.error}
            onResolve={c.handleResolveDispute}
          />
        )}

        {c.isSetTrickReviewer && (
          <SetTrickReviewPanel
            game={game}
            setterUsername={c.setterUsername}
            matcherUsername={c.matcherUsername}
            setReviewSubmitting={c.setReviewSubmitting}
            lastSetReviewAction={c.lastSetReviewAction}
            error={c.error}
            onRule={c.handleRuleSetTrick}
          />
        )}

        {c.isJudgeInvitePending && (
          <JudgeInviteCard
            game={game}
            submitting={c.judgeActionSubmitting}
            onAccept={c.handleJudgeAccept}
            onDecline={c.handleJudgeDecline}
          />
        )}

        {(game.turnHistory?.length ?? 0) > 0 && (
          <TurnHistoryViewer turns={game.turnHistory!} currentUserUid={profile.uid} />
        )}
      </div>

      {c.showReport && (
        <ReportModal
          reporterUid={profile.uid}
          reportedUid={c.opponentUid}
          reportedUsername={c.opponentName}
          gameId={game.id}
          onClose={c.closeReport}
          onSubmitted={c.markReported}
        />
      )}
    </div>
  );
}
