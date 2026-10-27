import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";
import { isFirebaseStorageUrl } from "../../utils/helpers";
import { ClipShareButtons } from "./ClipShareButtons";
import { TrickClip } from "../TrickClip";

interface WaitingClipPanelProps {
  game: GameDoc;
  profile: UserProfile;
  opponentName: string;
}

export function WaitingClipPanel({ game, profile, opponentName }: WaitingClipPanelProps) {
  if (game.phase === "disputable") {
    return (
      <div className="mt-6 w-full">
        <div className="text-center py-2 px-4 mb-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06]">
          <span className="font-display text-sm tracking-wider text-amber-400">UNDER REVIEW</span>
          <p className="font-body text-xs text-muted mt-0.5">
            {game.judgeUsername && game.judgeStatus === "accepted"
              ? `You claimed landed — referee @${game.judgeUsername} is ruling.`
              : `You claimed landed — waiting for @${opponentName}'s decision.`}
          </p>
        </div>
        {game.matchVideoUrl && isFirebaseStorageUrl(game.matchVideoUrl) && (
          <>
            <p className="font-display text-sm tracking-wider text-white mb-2">
              Your Attempt: {game.currentTrickName || "Trick"}
            </p>
            <TrickClip src={game.matchVideoUrl} label={`Your attempt at ${game.currentTrickName || "trick"}`} />
            <ClipShareButtons
              videoUrl={game.matchVideoUrl}
              trickName={game.currentTrickName || "trick"}
              ownerUid={profile.uid}
            />
          </>
        )}
      </div>
    );
  }

  if (game.phase === "matching") {
    return (
      <div className="mt-6 w-full">
        <p className="font-display text-sm tracking-wider text-brand-orange mb-2">
          Your Trick: {game.currentTrickName || "Trick"}
        </p>
        {game.currentTrickVideoUrl && isFirebaseStorageUrl(game.currentTrickVideoUrl) ? (
          <>
            <TrickClip src={game.currentTrickVideoUrl} label={`Video of ${game.currentTrickName || "trick"} you set`} />
            <ClipShareButtons
              videoUrl={game.currentTrickVideoUrl}
              trickName={game.currentTrickName || "trick"}
              ownerUid={profile.uid}
            />
          </>
        ) : (
          <p className="font-body text-sm text-subtle text-center py-4">No video recorded</p>
        )}
      </div>
    );
  }

  if (game.phase === "setting") {
    const lastTurn = game.turnHistory
      ?.slice()
      .reverse()
      .find((t) => {
        const wasMySet = t.setterUid === profile.uid && t.setVideoUrl;
        const wasMyMatch = t.matcherUid === profile.uid && t.matchVideoUrl;
        return wasMySet || wasMyMatch;
      });
    if (!lastTurn) return null;
    const iWasTheSetter = lastTurn.setterUid === profile.uid;
    const clipUrl = iWasTheSetter ? lastTurn.setVideoUrl : lastTurn.matchVideoUrl;
    const clipLabel = iWasTheSetter ? `Your ${lastTurn.trickName}` : `Your attempt at ${lastTurn.trickName}`;
    if (!clipUrl || !isFirebaseStorageUrl(clipUrl)) return null;
    return (
      <div className="mt-6 w-full">
        <p className="font-display text-sm tracking-wider text-brand-orange mb-2">{clipLabel}</p>
        <TrickClip src={clipUrl} label={clipLabel} />
        <ClipShareButtons videoUrl={clipUrl} trickName={lastTurn.trickName} ownerUid={profile.uid} />
      </div>
    );
  }

  return null;
}
