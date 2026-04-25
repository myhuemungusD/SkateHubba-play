import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";
import { isFirebaseStorageUrl } from "../../utils/helpers";
import { Btn } from "../../components/ui/Btn";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { LetterDisplay } from "../../components/LetterDisplay";
import { VideoRecorder } from "../../components/VideoRecorder";
import { UploadProgress } from "../../components/UploadProgress";
import { TurnHistoryViewer } from "../../components/TurnHistoryViewer";
import { WaitingScreen } from "../../components/WaitingScreen";
import { ReportModal } from "../../components/ReportModal";
import { ProUsername } from "../../components/ProUsername";
import { useGamePlayController } from "./useGamePlayController";
import { JudgeStatusBadge } from "./components/JudgeStatusBadge";
import { DisputeReviewPanel } from "./components/DisputeReviewPanel";
import { SetTrickReviewPanel } from "./components/SetTrickReviewPanel";
import { JudgeInviteCard } from "./components/JudgeInviteCard";
import { GamePlayHeader } from "./components/GamePlayHeader";

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

        {c.isJudge ? (
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
        ) : (
          <div className="flex justify-center gap-5 mb-6">
            <LetterDisplay
              count={c.myLetters}
              name={`@${profile.username}`}
              testId={`letter-display-${profile.username}`}
              active={c.isSetter}
              isVerifiedPro={profile.isVerifiedPro}
            />
            <div className="flex items-center font-display text-2xl text-subtle">VS</div>
            <LetterDisplay
              count={c.theirLetters}
              name={`@${c.opponentName}`}
              testId={`letter-display-${c.opponentName}`}
              active={c.isMatcher}
              isVerifiedPro={c.opponentIsPro}
            />
          </div>
        )}

        {!c.isJudge &&
          (c.isSetter ? (
            <div className="text-center mb-5 rounded-2xl border bg-brand-orange/[0.06] backdrop-blur-sm border-brand-orange/30 shadow-[0_0_20px_rgba(255,107,0,0.06)]">
              <label
                htmlFor="trickNameInput"
                className="font-display text-[11px] tracking-[0.2em] text-brand-orange block pt-3"
              >
                TRICK NAME
              </label>
              <input
                id="trickNameInput"
                type="text"
                value={c.trickName}
                onChange={(e) => c.setTrickName(e.target.value)}
                placeholder="Name your trick"
                maxLength={60}
                disabled={c.videoRecorded}
                autoCapitalize="words"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                className="w-full bg-transparent text-center font-display text-base tracking-wider text-brand-orange py-1 px-4 outline-none placeholder:text-brand-orange/60 disabled:opacity-40 disabled:cursor-not-allowed"
              />
              {c.trimmedTrickName && (
                <p className="font-body text-xs text-brand-orange/80 pb-1">Set your {c.trimmedTrickName}</p>
              )}
              {!c.showRecorder && !c.trimmedTrickName && (
                <span className="text-xs text-faint pb-2 block">Name your trick to start recording</span>
              )}
            </div>
          ) : (
            <div className="text-center py-3 px-5 mb-5 rounded-2xl border bg-brand-green/[0.06] backdrop-blur-sm border-brand-green/30 shadow-[0_0_20px_rgba(0,230,118,0.06)]">
              <span className="font-display text-xl tracking-wider text-brand-green">
                Match <ProUsername username={c.setterUsername} isVerifiedPro={c.setterIsPro} />
                &apos;s {game.currentTrickName || "trick"}
              </span>
            </div>
          ))}

        {c.isMatcher && (
          <div className="mb-5">
            <p className="font-display text-sm tracking-wider text-brand-orange mb-2">
              <ProUsername username={c.setterUsername} isVerifiedPro={c.setterIsPro} />
              &apos;s TRICK
            </p>
            {game.currentTrickVideoUrl && isFirebaseStorageUrl(game.currentTrickVideoUrl) ? (
              <video
                src={game.currentTrickVideoUrl}
                controls
                playsInline
                preload="metadata"
                aria-label={`Video of ${game.currentTrickName || "trick"} set by ${c.setterUsername}`}
                className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
              />
            ) : (
              <p className="font-body text-sm text-subtle text-center py-4">
                No video recorded — just match the trick!
              </p>
            )}

            {c.judgeActive && !c.videoRecorded && !c.callBSSubmitting && !c.error && (
              <div className="mt-3" role="group" aria-label="Attempt or call BS">
                <Btn
                  onClick={c.handleCallBS}
                  variant="secondary"
                  disabled={c.callBSSubmitting}
                  data-testid="call-bs-button"
                >
                  Call BS on this trick
                </Btn>
                <p className="font-body text-xs text-subtle mt-2 text-center">
                  Referee @{game.judgeUsername} will rule clean or sketchy.
                </p>
              </div>
            )}
            {c.callBSSubmitting && (
              <p className="font-display text-sm text-amber-400 mt-3 text-center animate-pulse">
                Sending to referee...
              </p>
            )}
          </div>
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

        {c.isSetter && c.videoRecorded && !c.submitting && !c.error && (
          <div className="mt-5" role="group" aria-label="Did you land the trick?">
            <p className="font-display text-xl text-white text-center mb-4">Did you land it?</p>
            <div className="flex gap-3">
              <Btn onClick={() => c.submitSetterTrick(c.videoBlob)} variant="success" disabled={c.submitting}>
                ✓ Landed
              </Btn>
              <Btn onClick={c.submitSetterMissed} variant="danger" disabled={c.submitting}>
                ✗ Missed
              </Btn>
            </div>
          </div>
        )}
        {c.isSetter && c.submitting && (
          <div className="mt-5 text-center">
            {c.uploadProgress ? (
              <UploadProgress progress={c.uploadProgress} />
            ) : (
              <span className="font-display text-lg text-brand-orange tracking-wider animate-pulse">
                {c.setterAction === "missed" ? "Passing turn..." : `Sending to @${c.opponentName}...`}
              </span>
            )}
          </div>
        )}
        {c.isSetter && !c.submitting && c.error && c.videoRecorded && (
          <div className="mt-5">
            <Btn
              onClick={c.setterAction === "missed" ? c.submitSetterMissed : () => c.submitSetterTrick(c.videoBlob)}
              variant="secondary"
            >
              Retry
            </Btn>
          </div>
        )}

        {c.isMatcher && c.videoRecorded && !c.submitting && !c.error && (
          <div className="mt-5" role="group" aria-label="Did you land the trick?">
            {c.uploadProgress ? (
              <UploadProgress progress={c.uploadProgress} />
            ) : (
              <>
                <p className="font-display text-xl text-white text-center mb-4">Did you land it?</p>
                <div className="flex gap-3">
                  <Btn onClick={() => c.submitMatchWithCall(true)} variant="success" disabled={c.submitting}>
                    ✓ Landed
                  </Btn>
                  <Btn onClick={() => c.submitMatchWithCall(false)} variant="danger" disabled={c.submitting}>
                    ✗ Missed
                  </Btn>
                </div>
              </>
            )}
          </div>
        )}
        {c.isMatcher && c.submitting && !c.uploadProgress && (
          <div className="mt-5 text-center">
            <span className="font-display text-lg text-brand-green tracking-wider animate-pulse">Submitting...</span>
          </div>
        )}
        {c.isMatcher && !c.submitting && c.error && c.videoRecorded && c.matcherLanded !== null && (
          <div className="mt-5">
            <Btn onClick={() => c.submitMatchWithCall(c.matcherLanded!)} variant="secondary">
              Retry
            </Btn>
          </div>
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
