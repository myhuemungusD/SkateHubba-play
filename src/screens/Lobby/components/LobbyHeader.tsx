import type { UserProfile } from "../../../services/users";
import type { GameDoc } from "../../../services/games";
import { NotificationBell } from "../../../components/NotificationBell";
import { HubbaIcon } from "../../../components/hubbaIcons";
import { ProUsername } from "../../../components/ProUsername";

interface Props {
  profile: UserProfile;
  games: GameDoc[];
  onViewRecord: () => void;
  onOpenGame: (g: GameDoc) => void;
  onOpenDice?: (gameId: string) => void;
  onOpenAppeal?: (path: string) => void;
  onOpenSettings?: () => void;
  onSignOut: () => void;
}

export function LobbyHeader({
  profile,
  games,
  onViewRecord,
  onOpenGame,
  onOpenDice,
  onOpenAppeal,
  onOpenSettings,
  onSignOut,
}: Props) {
  return (
    <div className="px-5 pt-safe pb-4 flex justify-between items-center border-b border-white/[0.04] bg-[#141414]/95 max-w-[430px] mx-auto">
      <img src="/logonew.webp" alt="" draggable={false} className="h-7 w-auto select-none" aria-hidden="true" />
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onViewRecord}
          data-tutorial="handle-display"
          className="flex items-center gap-2 transition-all duration-300 group rounded-xl px-2 py-1.5 touch-target hover:bg-white/[0.03]"
          title="View my record"
        >
          <div className="w-7 h-7 rounded-full bg-brand-orange/10 border border-brand-orange/20 flex items-center justify-center shrink-0 group-hover:shadow-glow-sm group-hover:border-brand-orange/40 transition-all duration-300">
            <span className="font-display text-[11px] text-brand-orange leading-none">
              {profile.username[0].toUpperCase()}
            </span>
          </div>
          <ProUsername
            username={profile.username}
            isVerifiedPro={profile.isVerifiedPro}
            className="font-body text-xs text-brand-orange group-hover:text-[#FF8533] transition-colors duration-300"
          />
        </button>
        <NotificationBell games={games} onOpenGame={onOpenGame} onOpenDice={onOpenDice} onOpenAppeal={onOpenAppeal} />
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            className="hb-press touch-target inline-flex items-center justify-center rounded-xl border border-border hover:border-border-hover hover:bg-white/[0.02] text-dim hover:text-white transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            <HubbaIcon name="settings" size={20} />
          </button>
        )}
        <button
          type="button"
          onClick={onSignOut}
          className="font-body text-xs text-dim hover:text-white transition-all duration-300 px-3 py-1.5 touch-target inline-flex items-center justify-center rounded-xl border border-border hover:border-border-hover hover:bg-white/[0.02]"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
