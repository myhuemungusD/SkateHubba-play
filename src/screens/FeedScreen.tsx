import type { UserProfile } from "../services/users";
import { ClipsFeed } from "../components/ClipsFeed";

interface Props {
  profile: UserProfile;
  /** Navigate to a player's public profile. */
  onViewPlayer: (uid: string) => void;
  /** Kick off a challenge flow against a username — used by the feed's "Challenge" CTA. */
  onChallengeUser: (username: string) => void;
}

/**
 * Standalone Clips tab — the only place clips are shown since the lobby
 * redesign dropped its feed. A thin wrapper: all feed behaviour lives in
 * `<ClipsFeed>`, and this screen only owns the page chrome (safe-area header,
 * 430px column, bottom-nav clearance).
 */
export function FeedScreen({ profile, onViewPlayer, onChallengeUser }: Props) {
  return (
    <div className="relative min-h-dvh bg-background/40 pb-24">
      <div className="px-5 pt-safe pb-4 border-b border-white/[0.04] glass max-w-[430px] mx-auto">
        <h1 className="font-display text-fluid-2xl leading-none text-white tracking-wide">Clips</h1>
      </div>

      <div className="px-5 pt-7 max-w-[430px] mx-auto">
        <ClipsFeed profile={profile} onViewPlayer={onViewPlayer} onChallengeUser={onChallengeUser} />
      </div>
    </div>
  );
}
