import type { FocusEvent, KeyboardEvent } from "react";
import type { GameDoc } from "../../../services/games";
import { TrophyIcon } from "../../../components/icons";
import { CompletedGameCard } from "./CompletedGameCard";

type CardButtonProps = {
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onKeyUp: (e: KeyboardEvent<HTMLElement>) => void;
  onBlur: (e: FocusEvent<HTMLElement>) => void;
};

interface Props {
  viewerUid: string;
  done: GameDoc[];
  showEmptyWhenNoDone: boolean;
  isJudge: (g: GameDoc) => boolean;
  isPlayer: (g: GameDoc) => boolean;
  opponent: (g: GameDoc) => string;
  opponentUid: (g: GameDoc) => string;
  opponentIsVerifiedPro: (g: GameDoc) => boolean | undefined;
  cardButtonProps: (handler: () => void) => CardButtonProps;
  onOpenGame: (g: GameDoc) => void;
  onViewPlayer?: (uid: string) => void;
}

export function CompletedGamesSection({
  viewerUid,
  done,
  showEmptyWhenNoDone,
  isJudge,
  isPlayer,
  opponent,
  opponentUid,
  opponentIsVerifiedPro,
  cardButtonProps,
  onOpenGame,
  onViewPlayer,
}: Props) {
  if (done.length === 0 && !showEmptyWhenNoDone) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">COMPLETED</h3>
        <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
          {done.length}
        </span>
      </div>
      {done.length > 0 ? (
        <div className="space-y-2">
          {done.map((g) => {
            const judgeViewer = isJudge(g) && !isPlayer(g);
            return (
              <CompletedGameCard
                key={g.id}
                game={g}
                judgeViewer={judgeViewer}
                viewerUid={viewerUid}
                opponentName={opponent(g)}
                opponentUid={opponentUid(g)}
                opponentIsVerifiedPro={opponentIsVerifiedPro(g)}
                cardButtonProps={cardButtonProps(() => onOpenGame(g))}
                onOpenGame={() => onOpenGame(g)}
                onViewPlayer={onViewPlayer}
              />
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center py-8 border border-dashed border-white/[0.06] rounded-2xl bg-surface/30 backdrop-blur-sm">
          <TrophyIcon size={24} className="mb-2 text-faint" />
          <p className="font-body text-xs text-faint">No finished games yet</p>
          <p className="font-body text-[11px] text-subtle mt-0.5">Complete a game to see your results here</p>
        </div>
      )}
    </div>
  );
}
