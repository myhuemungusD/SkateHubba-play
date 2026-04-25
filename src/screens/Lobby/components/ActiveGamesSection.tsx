import type { FocusEvent, KeyboardEvent } from "react";
import type { GameDoc } from "../../../services/games";
import { SkateboardIcon } from "../../../components/icons";
import { ActiveGameCard } from "./ActiveGameCard";

type CardButtonProps = {
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onKeyUp: (e: KeyboardEvent<HTMLElement>) => void;
  onBlur: (e: FocusEvent<HTMLElement>) => void;
};

interface Props {
  active: GameDoc[];
  liveActiveCount: number;
  showEmptyWhenNoActive: boolean;
  isJudge: (g: GameDoc) => boolean;
  isPlayer: (g: GameDoc) => boolean;
  isMyTurn: (g: GameDoc) => boolean;
  opponent: (g: GameDoc) => string;
  opponentUid: (g: GameDoc) => string;
  opponentIsVerifiedPro: (g: GameDoc) => boolean | undefined;
  myLetters: (g: GameDoc) => number;
  theirLetters: (g: GameDoc) => number;
  turnLabel: (g: GameDoc) => string;
  cardButtonProps: (handler: () => void) => CardButtonProps;
  onOpenGame: (g: GameDoc) => void;
  onViewPlayer?: (uid: string) => void;
}

export function ActiveGamesSection({
  active,
  liveActiveCount,
  showEmptyWhenNoActive,
  isJudge,
  isPlayer,
  isMyTurn,
  opponent,
  opponentUid,
  opponentIsVerifiedPro,
  myLetters,
  theirLetters,
  turnLabel,
  cardButtonProps,
  onOpenGame,
  onViewPlayer,
}: Props) {
  if (active.length === 0 && !showEmptyWhenNoActive) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">ACTIVE</h3>
        <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
          {active.length === 0 ? 0 : liveActiveCount}
        </span>
      </div>
      {active.length > 0 ? (
        <div className="space-y-2">
          {active.map((g) => {
            const judgeViewer = isJudge(g) && !isPlayer(g);
            return (
              <ActiveGameCard
                key={g.id}
                game={g}
                judgeViewer={judgeViewer}
                isMyTurn={isMyTurn(g)}
                opponentName={opponent(g)}
                opponentUid={opponentUid(g)}
                opponentIsVerifiedPro={opponentIsVerifiedPro(g)}
                myLetters={myLetters(g)}
                theirLetters={theirLetters(g)}
                turnLabel={turnLabel(g)}
                cardButtonProps={cardButtonProps(() => onOpenGame(g))}
                onOpenGame={() => onOpenGame(g)}
                onViewPlayer={onViewPlayer}
              />
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center py-8 border border-dashed border-white/[0.06] rounded-2xl bg-surface/30 backdrop-blur-sm">
          <SkateboardIcon size={24} className="mb-2 text-faint" />
          <p className="font-body text-xs text-faint">No active games right now</p>
          <p className="font-body text-[11px] text-subtle mt-0.5">Challenge someone to start a new round</p>
        </div>
      )}
    </div>
  );
}
