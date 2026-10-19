import { useEffect } from "react";
import { isSpotPresenceEnabled } from "../../lib/featureFlags";
import { startOnlineHeartbeat } from "../../services/onlineStatus";
import { ACTIVE_SPOT_EVENT, readActiveSpot, startSpotPresence } from "../../services/spotPresence";

/**
 * Runs while the app is open for a signed-in user with spot presence on:
 * the online heartbeat, plus the location watch for today's checked-in spot
 * (if any). Renders nothing.
 */
export function PresenceRunner({ uid }: { uid: string }) {
  useEffect(() => {
    if (!isSpotPresenceEnabled()) return;
    const stopOnline = startOnlineHeartbeat(uid);
    let stopSpot: (() => void) | null = null;
    const follow = () => {
      stopSpot?.();
      stopSpot = null;
      const spot = readActiveSpot();
      if (spot) stopSpot = startSpotPresence(spot, () => undefined);
    };
    follow();
    window.addEventListener(ACTIVE_SPOT_EVENT, follow);
    return () => {
      window.removeEventListener(ACTIVE_SPOT_EVENT, follow);
      stopSpot?.();
      stopOnline();
    };
  }, [uid]);
  return null;
}
