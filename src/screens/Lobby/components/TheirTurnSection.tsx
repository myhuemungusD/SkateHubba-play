import { useState } from "react";
import type { GameDoc } from "../../../services/games";
import type { LobbyController } from "../useLobbyController";
import { ActiveGameList } from "./ActiveGameList";
import { ChevronRightIcon } from "../../../components/icons";

interface Props {
  games: GameDoc[];
  c: LobbyController;
  onOpenGame: (g: GameDoc) => void;
  onViewPlayer?: (uid: string) => void;
}

/** Active games the viewer can't move on. Collapsed by default — they're
 *  context, not a task — and deliberately free of brand-orange. */
export function TheirTurnSection({ games, c, onOpenGame, onViewPlayer }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (games.length === 0) return null;

  return (
    <div className="mb-6">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="their-turn-list"
        onClick={() => setExpanded((v) => !v)}
        className="min-h-[44px] w-full flex items-center gap-1.5 font-body text-xs text-muted hover:text-white transition-colors duration-300 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      >
        <ChevronRightIcon
          size={13}
          className={`shrink-0 text-faint transition-transform duration-300 ${expanded ? "rotate-90" : ""}`}
        />
        <span className="tabular-nums">{games.length} waiting on them</span>
      </button>
      <div id="their-turn-list" hidden={!expanded} className="mt-3">
        {expanded && (
          <ActiveGameList games={games} c={c} urgent={false} onOpenGame={onOpenGame} onViewPlayer={onViewPlayer} />
        )}
      </div>
    </div>
  );
}
