import type { GameDoc } from "../../../services/games";
import { LobbyTimer } from "../../../components/LobbyTimer";
import { ChevronRightIcon } from "../../../components/icons";
import { ProUsername } from "../../../components/ProUsername";
import { trickCategoryLabel } from "../../../constants/trickCategories";
import { TurnLengthChip } from "../../../components/TurnLengthChip";
import { LetterPips } from "../../../components/LetterPips";

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
  onOpenGame,
  onViewPlayer,
}: Props) {
  const showCategory = !!game.trickCategory && game.trickCategory !== "any";
  const showProfile = !!onViewPlayer && !judgeViewer;
  // One tap target per card (design audit #4): the card is a native button
  // whose ::after stretches over the whole card; the opponent's avatar is a
  // separate sibling button layered above it, so nothing is nested.
  return (
    <div
      className={`relative flex items-center gap-3 p-4 rounded-2xl select-none transition-all duration-300 ease-smooth has-[.card-main:focus-visible]:outline-2 has-[.card-main:focus-visible]:outline-offset-2 has-[.card-main:focus-visible]:outline-brand-orange
      ${
        isMyTurn
          ? "glass-card border-brand-orange/30 shadow-glow-sm hover:shadow-glow-md"
          : "glass-card hover:border-white/[0.1]"
      }`}
    >
      {showProfile && (
        <button
          type="button"
          onClick={() => onViewPlayer(opponentUid)}
          aria-label={`View @${opponentName}'s profile`}
          className="relative z-10 -my-1 -ml-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-orange/10 border border-brand-orange/20 hover:border-brand-orange/50 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          <span aria-hidden="true" className="font-display text-lg text-brand-orange leading-none">
            {opponentName[0]?.toUpperCase()}
          </span>
        </button>
      )}
      <button
        type="button"
        onClick={onOpenGame}
        className="card-main flex min-w-0 flex-1 items-center justify-between text-left outline-none after:absolute after:inset-0 after:rounded-2xl after:content-['']"
      >
        <span className="block min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2 mb-1">
            {judgeViewer ? (
              <span className="font-display text-[1.1875rem] text-white leading-none">
                <span className="text-amber-400 text-label tracking-wider align-middle mr-1.5">REF</span>@
                {game.player1Username} vs @{game.player2Username}
              </span>
            ) : (
              <span className="font-display text-[1.1875rem] text-white leading-none">
                vs <ProUsername username={opponentName} isVerifiedPro={opponentIsVerifiedPro} />
              </span>
            )}
            {isMyTurn && (
              <span
                className={`px-2 py-0.5 rounded font-display text-sm text-black tracking-wider leading-none shrink-0 ${judgeViewer ? "bg-amber-500" : "bg-brand-orange"}`}
              >
                {judgeViewer ? "RULE" : "PLAY"}
              </span>
            )}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={`font-body text-label ${isMyTurn ? (judgeViewer ? "text-amber-400" : "text-brand-orange") : "text-brand-green"}`}
            >
              {turnLabel}
            </span>
            <LobbyTimer deadline={game.turnDeadline?.toMillis?.() ?? 0} isMyTurn={isMyTurn} />
            {showCategory && (
              <span className="inline-flex items-center rounded-full border border-white/[0.08] px-2 py-0.5 font-body text-xs text-bright shrink-0">
                {trickCategoryLabel(game.trickCategory)}
              </span>
            )}
            <TurnLengthChip hours={game.turnLengthHours} />
          </span>
          {judgeViewer ? (
            <span className="mt-2.5 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <LetterRow label={`@${game.player1Username}`} tone="text-amber-400" count={game.p1Letters} />
              <span className="hidden sm:block w-px h-3 bg-border shrink-0" aria-hidden="true" />
              <LetterRow label={`@${game.player2Username}`} tone="text-amber-400" count={game.p2Letters} />
            </span>
          ) : (
            <span className="mt-2.5 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <LetterRow label="You" tone="text-brand-orange" count={myLetters} />
              <span className="hidden sm:block w-px h-3 bg-border shrink-0" aria-hidden="true" />
              <LetterRow label="Them" tone="text-brand-orange" count={theirLetters} />
            </span>
          )}
        </span>
        <ChevronRightIcon size={15} className={`shrink-0 ml-3 ${isMyTurn ? "text-brand-orange" : "text-faint"}`} />
      </button>
    </div>
  );
}

function LetterRow({ label, tone, count }: { label: string; tone: string; count: number }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden="true"
        className={`min-w-10 max-w-[3.25rem] truncate font-body text-xs ${tone} uppercase tracking-wider sm:max-w-none`}
      >
        {label}
      </span>
      <LetterPips count={count} label={label} />
    </span>
  );
}
