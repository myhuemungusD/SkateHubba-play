import { getProProfileContent } from "../../../constants/proProfiles";
import { isProProfilesEnabled } from "../../../lib/featureFlags";
import { useIsAdmin } from "../../../hooks/useIsAdmin";
import { ProShowcase } from "./ProShowcase";

interface Props {
  username: string;
  wins: number;
  losses: number;
  /** Signed-in viewer uid, or "" when signed out. */
  viewerUid: string;
  onPlayPro?: () => void;
}

/**
 * Decides whether the pro showcase renders. Only profiles with configured
 * content qualify. With VITE_FEATURE_PRO_PROFILES on, everyone sees it; off
 * (production default), only admin-claim holders see it, in review mode.
 */
export function ProShowcaseGate({ username, wins, losses, viewerUid, onPlayPro }: Props) {
  const content = getProProfileContent(username);
  const flagOn = isProProfilesEnabled();
  // Skip the claim lookup entirely when there's nothing to show or the flag already opens it.
  const { isAdmin } = useIsAdmin(content && !flagOn ? viewerUid : "");
  if (!content || (!flagOn && !isAdmin)) return null;
  return (
    <ProShowcase
      content={content}
      username={username}
      wins={wins}
      losses={losses}
      reviewMode={!flagOn}
      onPlayPro={onPlayPro}
    />
  );
}
