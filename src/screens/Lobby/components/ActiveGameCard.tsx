import type { GameDoc } from "../../../services/games";
import { LETTERS } from "../../../utils/helpers";
import { LobbyTimer } from "../../../components/LobbyTimer";
import { ChevronRightIcon } from "../../../components/icons";
import { ProUsername } from "../../../components/ProUsername";
import type { CardButtonProps } from "../useLobbyController";

interface Props {
  game: GameDoc;
  judgeViewer: boolean;
  isMyTurn: boolean;
  opponentName: string;
  opponentUid: string;
  opponentIsVerifiedPro: boolean | undefined;
  myLetters: number;
  theirLetters: number;
  turnLabel: string;
  cardButtonProps: CardButtonProps;
  onOpenGame: () => void;
  onViewPlayer?: (uid: string) => void;
}

export function ActiveGameCard({
  game,
  judgeViewer,
  isMyTurn,
  opponentName,
  opponentUid,
  opponentIsVerifiedPro,
  myLetters,
  theirLetters,
  turnLabel,
  cardButtonProps,
  onOpenGame,
  onViewPlayer,
}: Props) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenGame}
      {...cardButtonProps}
      className={`relative flex items-center justify-between p-4 rounded-2xl cursor-pointer select-none transition-all duration-300 ease-smooth overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange text-left w-full
      ${
        isMyTurn
          ? "glass-card border-brand-orange/30 shadow-glow-sm hover:shadow-glow-md hover:-translate-y-0.5"
          : "glass-card hover:border-white/[0.1] hover:-translate-y-0.5"
      }`}
    >
      {isMyTurn && (
        <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-brand-orange rounded-l-2xl" aria-hidden="true" />
      )}
      <div className="pl-1 min-w-0">
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
          {isMyTurn && (
            <span
              className={`px-2 py-0.5 rounded font-display text-[10px] text-white tracking-wider leading-none shrink-0 ${judgeViewer ? "bg-amber-500" : "bg-brand-orange"}`}
            >
              {judgeViewer ? "RULE" : "PLAY"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`font-body text-[11px] ${isMyTurn ? (judgeViewer ? "text-amber-400" : "text-brand-orange") : "text-brand-green"}`}
          >
            {turnLabel}
          </span>
          <LobbyTimer deadline={game.turnDeadline?.toMillis?.() ?? 0} isMyTurn={isMyTurn} />
        </div>
        {judgeViewer ? (
          <div className="flex items-center gap-3 mt-2.5">
            <div className="flex items-center gap-1">
              <span className="font-body text-[10px] text-amber-400 uppercase tracking-wider mr-0.5">
                @{game.player1Username}
              </span>
              {LETTERS.map((l, i) => (
                <span
                  key={i}
                  className={`font-display text-[13px] leading-none tracking-wide ${i < game.p1Letters ? "text-brand-red" : "text-faint"}`}
                >
                  {l}
                </span>
              ))}
            </div>
            <div className="w-px h-3 bg-border shrink-0" aria-hidden="true" />
            <div className="flex items-center gap-1">
              <span className="font-body text-[10px] text-amber-400 uppercase tracking-wider mr-0.5">
                @{game.player2Username}
              </span>
              {LETTERS.map((l, i) => (
                <span
                  key={i}
                  className={`font-display text-[13px] leading-none tracking-wide ${i < game.p2Letters ? "text-brand-red" : "text-[#2E2E2E]"}`}
                >
                  {l}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 mt-2.5">
            <div className="flex items-center gap-1">
              <span className="font-body text-[10px] text-brand-orange uppercase tracking-wider mr-0.5">You</span>
              {LETTERS.map((l, i) => (
                <span
                  key={i}
                  className={`font-display text-[13px] leading-none tracking-wide ${i < myLetters ? "text-brand-red" : "text-faint"}`}
                >
                  {l}
                </span>
              ))}
            </div>
            <div className="w-px h-3 bg-border shrink-0" aria-hidden="true" />
            <div className="flex items-center gap-1">
              <span className="font-body text-[10px] text-brand-orange uppercase tracking-wider mr-0.5">Them</span>
              {LETTERS.map((l, i) => (
                <span
                  key={i}
                  className={`font-display text-[13px] leading-none tracking-wide ${i < theirLetters ? "text-brand-red" : "text-[#2E2E2E]"}`}
                >
                  {l}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <ChevronRightIcon size={15} className={`shrink-0 ml-3 ${isMyTurn ? "text-brand-orange" : "text-faint"}`} />
    </div>
  );
}
