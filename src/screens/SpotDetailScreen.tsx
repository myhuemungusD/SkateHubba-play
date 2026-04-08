import { useState, useEffect } from "react";
import { getSpotById, fetchSpotGames, type Spot } from "../services/spots";
import type { UserProfile } from "../services/users";
import type { GameDoc } from "../services/games";
import { Btn } from "../components/ui/Btn";
import { MapPinIcon, ChevronLeftIcon, TrophyIcon } from "../components/icons";
import { Spinner } from "../components/ui/Spinner";
import { ProUsername } from "../components/ProUsername";

export function SpotDetailScreen({
  spotId,
  profile,
  onBack,
  onOpenGame,
  onViewPlayer,
}: {
  spotId: string;
  profile: UserProfile;
  onBack: () => void;
  onOpenGame?: (game: GameDoc) => void;
  onViewPlayer?: (uid: string) => void;
}) {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [games, setGames] = useState<GameDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let stale = false;

    Promise.all([getSpotById(spotId), fetchSpotGames(spotId)])
      .then(([spotData, gamesData]) => {
        if (stale) return;
        setSpot(spotData);
        setGames(gamesData as unknown as GameDoc[]);
      })
      .catch((err) => {
        if (!stale) setError(err instanceof Error ? err.message : "Failed to load spot");
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });

    return () => {
      stale = true;
    };
  }, [spotId]);

  if (loading) {
    return (
      <div className="min-h-dvh bg-[#0A0A0A] flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (error || !spot) {
    return (
      <div className="min-h-dvh bg-[#0A0A0A] flex flex-col items-center justify-center px-6">
        <MapPinIcon size={40} className="text-brand-red mb-4" />
        <h1 className="font-display text-2xl text-white mb-2">Spot Not Found</h1>
        <p className="font-body text-sm text-[#888] mb-6">{error || "This spot doesn't exist."}</p>
        <Btn onClick={onBack} variant="ghost">
          Back to Map
        </Btn>
      </div>
    );
  }

  const isCreator = spot.createdByUid === profile.uid;

  return (
    <div className="min-h-dvh bg-[#0A0A0A]/40 pb-24">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex items-center gap-3 border-b border-white/[0.04] glass">
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-xl hover:bg-white/[0.05] transition-colors"
          aria-label="Back"
        >
          <ChevronLeftIcon size={20} className="text-brand-orange" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-lg text-white tracking-wide truncate">{spot.name}</h1>
          <p className="font-body text-[11px] text-dim">
            {spot.latitude.toFixed(4)}, {spot.longitude.toFixed(4)}
          </p>
        </div>
      </div>

      <div className="px-5 pt-6 max-w-lg mx-auto">
        {/* Spot info card */}
        <div className="p-5 rounded-2xl glass-card mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-brand-orange/10 border border-brand-orange/20 flex items-center justify-center shrink-0">
              <MapPinIcon size={24} className="text-brand-orange" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-xl text-white leading-tight">{spot.name}</h2>
              <p className="font-body text-xs text-brand-green mt-0.5">
                {spot.gameCount} {spot.gameCount === 1 ? "game" : "games"} played here
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="font-body text-dim">Created by</span>
            {onViewPlayer ? (
              <button
                type="button"
                onClick={() => onViewPlayer(spot.createdByUid)}
                className="font-display text-brand-orange hover:text-[#FF7A1A] transition-colors"
              >
                @{spot.createdByUsername}
              </button>
            ) : (
              <span className="font-display text-brand-orange">@{spot.createdByUsername}</span>
            )}
            {isCreator && (
              <span className="px-1.5 py-0.5 rounded bg-brand-orange/10 border border-brand-orange/20 font-display text-[9px] text-brand-orange tracking-wider">
                YOU
              </span>
            )}
          </div>
        </div>

        {/* Games at this spot */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">GAMES AT THIS SPOT</h3>
            <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
              {games.length}
            </span>
          </div>

          {games.length === 0 ? (
            <div className="flex flex-col items-center py-10 border border-dashed border-white/[0.06] rounded-2xl bg-surface/30 backdrop-blur-sm">
              <TrophyIcon size={24} className="mb-2 opacity-40 text-subtle" />
              <p className="font-body text-xs text-faint">No games tagged here yet</p>
              <p className="font-body text-[11px] text-subtle mt-0.5">
                Tag a completed game from the Game Over screen
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {games.map((g) => {
                const isWinner = g.winner === profile.uid;
                const isParticipant = g.player1Uid === profile.uid || g.player2Uid === profile.uid;
                return (
                  <button
                    type="button"
                    key={g.id}
                    onClick={() => isParticipant && onOpenGame?.(g)}
                    disabled={!isParticipant}
                    className={`flex items-center justify-between p-4 rounded-2xl glass-card transition-all duration-300 ease-smooth text-left w-full ${isParticipant ? "cursor-pointer hover:-translate-y-0.5" : "opacity-60 cursor-default"}`}
                  >
                    <div>
                      <span className="font-display text-base text-white leading-none">
                        <ProUsername username={g.player1Username} isVerifiedPro={g.player1IsVerifiedPro} /> vs{" "}
                        <ProUsername username={g.player2Username} isVerifiedPro={g.player2IsVerifiedPro} />
                      </span>
                      {isParticipant && (
                        <span
                          className={`font-body text-[11px] block mt-1 ${isWinner ? "text-brand-green" : "text-brand-red"}`}
                        >
                          {isWinner ? "You won" : "You lost"}
                          {g.status === "forfeit" ? " (forfeit)" : ""}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <Btn onClick={onBack} variant="ghost">
          Back to Map
        </Btn>
      </div>
    </div>
  );
}
