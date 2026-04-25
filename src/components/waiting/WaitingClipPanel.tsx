import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";
import { isFirebaseStorageUrl } from "../../utils/helpers";
import { ClipShareButtons } from "./ClipShareButtons";

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
          <span className="font-display text-xs tracking-wider text-amber-400">UNDER REVIEW</span>
          <p className="font-body text-xs text-muted mt-0.5">
            {game.judgeUsername && game.judgeStatus === "accepted"
              ? `You claimed landed — referee @${game.judgeUsername} is ruling.`
              : `You claimed landed — waiting for @${opponentName}'s decision.`}
          </p>
        </div>
        {game.matchVideoUrl && isFirebaseStorageUrl(game.matchVideoUrl) && (
          <>
            <p className="font-display text-sm tracking-wider text-brand-green mb-2">
              Your Attempt: {game.currentTrickName || "Trick"}
            </p>
            <video
              src={game.matchVideoUrl}
              controls
              playsInline
              preload="metadata"
              aria-label={`Your attempt at ${game.currentTrickName || "trick"}`}
              className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
            />
            <ClipShareButtons videoUrl={game.matchVideoUrl} trickName={game.currentTrickName || "trick"} />
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
            <video
              src={game.currentTrickVideoUrl}
              controls
              playsInline
              preload="metadata"
              aria-label={`Video of ${game.currentTrickName || "trick"} you set`}
              className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
            />
            <ClipShareButtons videoUrl={game.currentTrickVideoUrl} trickName={game.currentTrickName || "trick"} />
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
        <video
          src={clipUrl}
          controls
          playsInline
          preload="metadata"
          aria-label={clipLabel}
          className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
        />
        <ClipShareButtons videoUrl={clipUrl} trickName={lastTurn.trickName} />
      </div>
    );
  }

  return null;
}
