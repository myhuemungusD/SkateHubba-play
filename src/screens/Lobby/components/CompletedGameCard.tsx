import type { GameDoc } from "../../../services/games";
import { ChevronRightIcon } from "../../../components/icons";
import { ProUsername } from "../../../components/ProUsername";
import type { CardButtonProps } from "../useLobbyController";

interface Props {
  game: GameDoc;
  judgeViewer: boolean;
  viewerUid: string;
  opponentName: string;
  opponentUid: string;
  opponentIsVerifiedPro: boolean | undefined;
  cardButtonProps: CardButtonProps;
  onOpenGame: () => void;
  onViewPlayer?: (uid: string) => void;
}

export function CompletedGameCard({
  game,
  judgeViewer,
  viewerUid,
  opponentName,
  opponentUid,
  opponentIsVerifiedPro,
  cardButtonProps,
  onOpenGame,
  onViewPlayer,
}: Props) {
  const winnerName = game.winner === game.player1Uid ? game.player1Username : game.player2Username;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenGame}
      {...cardButtonProps}
      className="flex items-center justify-between p-4 rounded-2xl glass-card cursor-pointer select-none transition-all duration-300 ease-smooth opacity-75 hover:opacity-100 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange text-left w-full"
    >
      <div>
        <div className="flex items-center gap-2 mb-1">
          {judgeViewer ? (
            <span className="font-display text-[19px] text-white leading-none">
              <span className="text-amber-400 text-[11px] tracking-wider align-middle mr-1.5">REF</span>@
              {game.player1Username} vs @{game.player2Username}
            </span>
          ) : (
            <span className="font-display text-[19px] text-white leading-none">
              vs <ProUsername username={opponentName} isVerifiedPro={opponentIsVerifiedPro} />
            </span>
          )}
          {onViewPlayer && !judgeViewer && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onViewPlayer(opponentUid);
              }}
              className="min-h-[32px] inline-flex items-center justify-center px-2 -mx-2 rounded-md font-display text-[10px] text-brand-orange hover:text-[#FF7A1A] hover:bg-brand-orange/10 transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              aria-label={`View @${opponentName}'s profile`}
            >
              Profile
            </button>
          )}
        </div>
        <span
          className={`font-body text-[11px] ${judgeViewer ? "text-subtle" : game.winner === viewerUid ? "text-brand-green" : "text-brand-red"}`}
        >
          {judgeViewer
            ? `@${winnerName} won${game.status === "forfeit" ? " · forfeit" : ""}`
            : `${game.winner === viewerUid ? "You won" : "You lost"}${game.status === "forfeit" ? " · forfeit" : ""}`}
        </span>
      </div>
      <ChevronRightIcon size={15} className="text-faint shrink-0" />
    </div>
  );
}
