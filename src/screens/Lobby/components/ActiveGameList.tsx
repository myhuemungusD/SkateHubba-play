import type { GameDoc } from "../../../services/games";
import type { LobbyController } from "../useLobbyController";
import { ActiveGameCard } from "./ActiveGameCard";

interface Props {
  games: GameDoc[];
  c: LobbyController;
  /** Drives the card's urgent treatment. Forced per-section rather than read
   *  off the game, so "waiting on them" rows stay quiet even when the raw
   *  currentTurn still points at the viewer (expired or frozen turns). */
  urgent: boolean;
  onOpenGame: (g: GameDoc) => void;
  onViewPlayer?: (uid: string) => void;
}

export function ActiveGameList({ games, c, urgent, onOpenGame, onViewPlayer }: Props) {
  return (
    <div className="space-y-2">
      {games.map((g) => (
        <ActiveGameCard
          key={g.id}
          game={g}
          judgeViewer={c.isJudge(g) && !c.isPlayer(g)}
          isMyTurn={urgent}
          opponentName={c.opponent(g)}
          opponentUid={c.opponentUid(g)}
          opponentIsVerifiedPro={c.opponentIsVerifiedPro(g)}
          myLetters={c.myLetters(g)}
          theirLetters={c.theirLetters(g)}
          turnLabel={c.turnLabel(g)}
          cardButtonProps={c.cardButtonProps(() => onOpenGame(g))}
          onOpenGame={() => onOpenGame(g)}
          onViewPlayer={onViewPlayer}
        />
      ))}
    </div>
  );
}
