import { useEffect, useState } from "react";
import { getPlayerDirectory, type UserProfile } from "../services/users";
import { getBlockedUserIds } from "../services/blocking";
import { logger } from "../services/logger";

export interface PlayerDirectoryState {
  players: UserProfile[];
  loading: boolean;
}

/**
 * Load the public player directory for the lobby, minus the viewer themselves
 * and anyone they've blocked. Non-critical: a failure surfaces an empty list
 * rather than an error, because the lobby has other content to show.
 */
export function usePlayerDirectory(viewerUid: string): PlayerDirectoryState {
  const [players, setPlayers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stale = false;
    Promise.all([getPlayerDirectory(), getBlockedUserIds(viewerUid)])
      .then(([all, blockedIds]) => {
        if (!stale) setPlayers(all.filter((p) => p.uid !== viewerUid && !blockedIds.has(p.uid)));
      })
      .catch((err) => {
        // Non-critical: show empty lobby rather than error screen
        logger.warn("[usePlayerDirectory] load failed", err);
        if (!stale) setPlayers([]);
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [viewerUid]);

  return { players, loading };
}
