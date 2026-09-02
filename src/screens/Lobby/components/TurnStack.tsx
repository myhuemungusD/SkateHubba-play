import type { GameDoc } from "../../../services/games";
import type { LobbyController } from "../useLobbyController";
import { ActiveGameList } from "./ActiveGameList";

interface Props {
  games: GameDoc[];
  c: LobbyController;
  onOpenGame: (g: GameDoc) => void;
  onViewPlayer?: (uid: string) => void;
}

/** The one thing home has to answer: whose turn is it. Pinned to the top,
 *  sorted by urgency, and the only place brand-orange is spent on this screen. */
export function TurnStack({ games, c, onOpenGame, onViewPlayer }: Props) {
  if (games.length === 0) return null;

  return (
    <section aria-labelledby="turn-stack-heading" className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <h2 id="turn-stack-heading" className="font-display text-[11px] tracking-[0.2em] text-brand-orange">
          YOUR TURN
        </h2>
        <span className="px-1.5 py-0.5 rounded bg-brand-orange/10 border border-brand-orange/25 font-display text-[10px] text-brand-orange leading-none tabular-nums">
          {games.length}
        </span>
      </div>
      <ActiveGameList games={games} c={c} urgent onOpenGame={onOpenGame} onViewPlayer={onViewPlayer} />
    </section>
  );
}
