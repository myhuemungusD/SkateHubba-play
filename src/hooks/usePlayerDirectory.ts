import { useCallback, useEffect, useState } from "react";
import { getPlayerDirectory, type UserProfile } from "../services/users";
import { getBlockedUserIds } from "../services/blocking";
import { logger } from "../services/logger";

export interface PlayerDirectoryState {
  players: UserProfile[];
  loading: boolean;
  /** Re-fetch the directory on demand — used by Lobby's pull-to-refresh gesture. */
  refresh: () => Promise<void>;
}

/**
 * Load the public player directory for the lobby, minus the viewer themselves
 * and anyone they've blocked. Non-critical: a failure surfaces an empty list
 * rather than an error, because the lobby has other content to show.
 *
 * Returns a `refresh()` so callers (e.g. pull-to-refresh) can trigger a
 * re-fetch without re-mounting. The hook otherwise auto-refreshes only when
 * `viewerUid` changes.
 */
export function usePlayerDirectory(viewerUid: string): PlayerDirectoryState {
  const [players, setPlayers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  // Shared loader — used by both the initial mount effect (wrapped with a
  // stale-guard for unmount safety) and the user-initiated refresh below.
  // The refresh path intentionally skips staleness checks: it's always
  // triggered by a live component and must always resolve so callers
  // (PTR, manual retry) can await it and dismiss their UI.
  const refresh = useCallback(async () => {
    try {
      const [all, blockedIds] = await Promise.all([getPlayerDirectory(), getBlockedUserIds(viewerUid)]);
      setPlayers(all.filter((p) => p.uid !== viewerUid && !blockedIds.has(p.uid)));
    } catch (err) {
      // Non-critical: show empty lobby rather than error screen
      logger.warn("player_directory_load_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      setPlayers([]);
    } finally {
      setLoading(false);
    }
  }, [viewerUid]);

  useEffect(() => {
    let stale = false;
    Promise.all([getPlayerDirectory(), getBlockedUserIds(viewerUid)])
      .then(([all, blockedIds]) => {
        if (!stale) setPlayers(all.filter((p) => p.uid !== viewerUid && !blockedIds.has(p.uid)));
      })
      .catch((err) => {
        logger.warn("player_directory_load_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        if (!stale) setPlayers([]);
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [viewerUid]);

  return { players, loading, refresh };
}
