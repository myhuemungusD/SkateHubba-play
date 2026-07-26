import type { GameDoc } from "../services/games";
import type { UserProfile } from "../services/users";
import { TurnHistoryViewer } from "./TurnHistoryViewer";
import { ReportModal } from "./ReportModal";
import { useWaitingScreen } from "./waiting/useWaitingScreen";
import { WaitingHeader } from "./waiting/WaitingHeader";
import { WaitingClipPanel } from "./waiting/WaitingClipPanel";
import { WaitingActions } from "./waiting/WaitingActions";

export function WaitingScreen({ game, profile, onBack }: { game: GameDoc; profile: UserProfile; onBack: () => void }) {
  const state = useWaitingScreen(game, profile);

  return (
    <div className="min-h-dvh bg-background/80 flex flex-col items-center px-6 py-8 overflow-y-auto">
      <div className="text-center w-full max-w-sm animate-scale-in">
        <WaitingHeader
          game={game}
          profile={profile}
          isJudge={state.isJudge}
          myLetters={state.myLetters}
          theirLetters={state.theirLetters}
          opponentName={state.opponentName}
          opponentIsPro={state.opponentIsPro}
          activePlayerUsername={state.activePlayerUsername}
          waitingOnLabel={state.waitingOnLabel}
          deadline={state.deadline}
        />

        <WaitingClipPanel game={game} profile={profile} opponentName={state.opponentName} />

        {(game.turnHistory?.length ?? 0) > 0 && (
          <div className="mt-6 text-left w-full">
            <TurnHistoryViewer
              turns={game.turnHistory!}
              currentUserUid={profile.uid}
              defaultExpanded
              showDownload
              showShare
            />
          </div>
        )}

        <WaitingActions
          // Also hidden while the game is waiting on the JUDGE: the nudge always
          // targets the opponent, so offering it here poked someone who wasn't
          // holding anything up (and burned the sender's 1-hour cooldown) while
          // the screen said "Waiting on @judge". Hidden rather than disabled —
          // there is no action to take, and a dead button invites a support ticket.
          showNudge={game.status === "active" && !state.isJudge && !state.isJudgeTurn}
          nudgeStatus={state.nudgeStatus}
          nudgeError={state.nudgeError}
          nudgeAvailable={state.nudgeAvailable}
          onNudge={state.handleNudge}
          onBack={onBack}
          showReportLink={!state.isJudge}
          reported={state.reported}
          onOpenReport={state.openReport}
        />
      </div>

      {state.showReport && !state.isJudge && (
        <ReportModal
          reporterUid={profile.uid}
          reportedUid={state.opponentUid}
          reportedUsername={state.opponentName}
          gameId={game.id}
          onClose={state.closeReport}
          onSubmitted={state.markReported}
        />
      )}
    </div>
  );
}
