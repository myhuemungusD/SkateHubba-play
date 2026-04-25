import type { GameDoc } from "../../../services/games";
import { SkateboardIcon } from "../../../components/icons";
import { GameHistoryCard } from "./GameHistoryCard";
import { SectionHeader } from "./SectionHeader";

interface Props {
  isOwnProfile: boolean;
  profileUsername: string;
  profileUid: string;
  completedGames: GameDoc[];
  expandedGameId: string | null;
  toggleExpanded: (id: string) => void;
  onOpenGame: (g: GameDoc) => void;
}

export function GameHistorySection({
  isOwnProfile,
  profileUsername,
  profileUid,
  completedGames,
  expandedGameId,
  toggleExpanded,
  onOpenGame,
}: Props) {
  return (
    <div className="mb-6 animate-fade-in">
      <SectionHeader title={isOwnProfile ? "GAME HISTORY" : "GAMES VS YOU"} count={completedGames.length} />

      {completedGames.length === 0 ? (
        <div className="flex flex-col items-center py-14 border border-dashed border-border rounded-2xl">
          <SkateboardIcon size={28} className="mb-3 opacity-30 text-subtle" />
          <p className="font-body text-sm text-faint">
            {isOwnProfile ? "No games played yet" : "No games between you two yet"}
          </p>
          <p className="font-body text-[11px] text-subtle mt-1">
            {isOwnProfile
              ? "Challenge someone and finish a game to build your record"
              : `Challenge @${profileUsername} to start a rivalry`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {completedGames.map((g) => (
            <GameHistoryCard
              key={g.id}
              game={g}
              profileUid={profileUid}
              expanded={expandedGameId === g.id}
              onToggle={toggleExpanded}
              onOpenGame={onOpenGame}
            />
          ))}
        </div>
      )}
    </div>
  );
}
