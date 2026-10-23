import { useCallback, useEffect, useState } from "react";
import { getLeaderboard, type UserProfile } from "../../services/users";
import { getBlockedUserIds } from "../../services/blocking";

const LOAD_ERROR = "Couldn't load the leaderboard.";

/**
 * Ranked players for the leaderboard, minus anyone the viewer blocked and
 * anyone without a finished game. Retry reuses the same loader, so a
 * transient first-load error can never surface a blocked player.
 */
export function useLeaderboard(viewerUid: string) {
  const [players, setPlayers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [all, blockedIds] = await Promise.all([getLeaderboard(), getBlockedUserIds(viewerUid)]);
    return all.filter((p) => !blockedIds.has(p.uid) && (p.wins ?? 0) + (p.losses ?? 0) > 0);
  }, [viewerUid]);

  // Only the promise callbacks set state, so the mount effect never sets
  // state synchronously; retry resets the error and spinner itself.
  const settle = useCallback(
    (isStale: () => boolean) =>
      load()
        .then((ranked) => !isStale() && setPlayers(ranked))
        .catch(() => !isStale() && setError(LOAD_ERROR))
        .finally(() => !isStale() && setLoading(false)),
    [load],
  );

  useEffect(() => {
    let stale = false;
    void settle(() => stale);
    return () => {
      stale = true;
    };
  }, [settle]);

  const retry = useCallback(() => {
    setError("");
    setLoading(true);
    void settle(() => false);
  }, [settle]);
  return { players, loading, error, retry };
}
