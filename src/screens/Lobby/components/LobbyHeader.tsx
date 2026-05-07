import type { UserProfile } from "../../../services/users";
import type { GameDoc } from "../../../services/games";
import { NotificationBell } from "../../../components/NotificationBell";
import { ProUsername } from "../../../components/ProUsername";

interface Props {
  profile: UserProfile;
  games: GameDoc[];
  onViewRecord: () => void;
  onOpenGame: (g: GameDoc) => void;
  onOpenSettings?: () => void;
  onSignOut: () => void;
}

export function LobbyHeader({ profile, games, onViewRecord, onOpenGame, onOpenSettings, onSignOut }: Props) {
  return (
    <div className="px-5 pt-safe pb-4 flex justify-between items-center border-b border-white/[0.04] glass max-w-2xl mx-auto">
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
        <NotificationBell games={games} onOpenGame={onOpenGame} />
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            className="touch-target inline-flex items-center justify-center rounded-xl border border-border hover:border-border-hover hover:bg-white/[0.02] text-dim hover:text-white transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
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
