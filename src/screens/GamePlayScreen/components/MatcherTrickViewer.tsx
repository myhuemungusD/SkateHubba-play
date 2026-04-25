import { ProUsername } from "../../../components/ProUsername";
import { Btn } from "../../../components/ui/Btn";
import type { GameDoc } from "../../../services/games";
import { isFirebaseStorageUrl } from "../../../utils/helpers";

interface Props {
  game: GameDoc;
  setterUsername: string;
  setterIsPro: boolean | undefined;
  judgeActive: boolean;
  videoRecorded: boolean;
  callBSSubmitting: boolean;
  error: string;
  onCallBS: () => void;
}

export function MatcherTrickViewer({
  game,
  setterUsername,
  setterIsPro,
  judgeActive,
  videoRecorded,
  callBSSubmitting,
  error,
  onCallBS,
}: Props) {
  return (
    <div className="mb-5">
      <p className="font-display text-sm tracking-wider text-brand-orange mb-2">
        <ProUsername username={setterUsername} isVerifiedPro={setterIsPro} />
        &apos;s TRICK
      </p>
      {game.currentTrickVideoUrl && isFirebaseStorageUrl(game.currentTrickVideoUrl) ? (
        <video
          src={game.currentTrickVideoUrl}
          controls
          playsInline
          preload="metadata"
          aria-label={`Video of ${game.currentTrickName || "trick"} set by ${setterUsername}`}
          className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
        />
      ) : (
        <p className="font-body text-sm text-subtle text-center py-4">No video recorded — just match the trick!</p>
      )}

      {judgeActive && !videoRecorded && !callBSSubmitting && !error && (
        <div className="mt-3" role="group" aria-label="Attempt or call BS">
          <Btn onClick={onCallBS} variant="secondary" disabled={callBSSubmitting} data-testid="call-bs-button">
            Call BS on this trick
          </Btn>
          <p className="font-body text-xs text-subtle mt-2 text-center">
            Referee @{game.judgeUsername} will rule clean or sketchy.
          </p>
        </div>
      )}
      {callBSSubmitting && (
        <p className="font-display text-sm text-amber-400 mt-3 text-center animate-pulse">Sending to referee...</p>
      )}
    </div>
  );
}
