import type { UserProfile } from "../services/users";
import { ClipsFeed } from "../components/ClipsFeed";
import { ProPicks } from "../components/pro/ProPicks";
import { isProCommunityEnabled } from "../lib/featureFlags";

interface Props {
  profile: UserProfile;
  /** Navigate to a player's public profile. */
  onViewPlayer: (uid: string) => void;
  /** Kick off a challenge flow against a username — used by the feed's "Challenge" CTA. */
  onChallengeUser: (username: string) => void;
}

/**
 * Standalone Clips tab. The feed fills the viewport; the fixed bottom nav
 * overlays the bottom edge and each slide keeps its controls above that bar
 * and the top safe area.
 */
export function FeedScreen({ profile, onViewPlayer, onChallengeUser }: Props) {
  return (
    <div className="relative h-dvh bg-black">
      <h1 className="sr-only">Clips</h1>
      {isProCommunityEnabled() && <ProPicks player={{ uid: profile.uid, username: profile.username }} />}
      <ClipsFeed profile={profile} onViewPlayer={onViewPlayer} onChallengeUser={onChallengeUser} />
    </div>
  );
}
