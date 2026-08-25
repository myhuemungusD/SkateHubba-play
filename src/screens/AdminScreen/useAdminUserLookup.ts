import { useCallback, useState } from "react";
import { getUidByUsername, getUserProfile, type UserProfile } from "../../services/users";
import { logger } from "../../services/logger";
import { parseFirebaseError } from "../../utils/helpers";

export interface AdminUserLookup {
  query: string;
  setQuery: (value: string) => void;
  /** The looked-up player, or null before a successful lookup. */
  target: UserProfile | null;
  loading: boolean;
  /** Operator-facing failure copy. Empty string when there's nothing wrong. */
  error: string;
  /** Resolve the current `query` to a profile. */
  lookup: () => Promise<void>;
  /** Re-read the current target — every action refetches instead of guessing. */
  refresh: () => Promise<void>;
}

/**
 * Username → profile lookup shared by the Verify Pro and Awards tabs.
 *
 * Two reads on purpose: `usernames/{name}` is the only doc that maps a handle
 * to a uid, and the profile behind it carries the state the panels display
 * (`isVerifiedPro`). The uid from the username reservation wins over the one
 * stored on the profile doc — the reservation is what the rest of the app
 * treats as authoritative for "who owns this handle".
 *
 * Every panel refetches through `refresh` after a mutation rather than
 * patching local state: an admin acting on stale data is how double-grants
 * happen, and these actions are rare enough that a round trip costs nothing.
 */
export function useAdminUserLookup(): AdminUserLookup {
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (username: string) => {
    const normalized = username.toLowerCase().trim();
    if (!normalized) {
      setError("Enter a username.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const uid = await getUidByUsername(normalized);
      if (!uid) {
        setTarget(null);
        setError(`No player found for @${normalized}`);
        return;
      }
      const profile = await getUserProfile(uid);
      if (!profile) {
        setTarget(null);
        setError(`@${normalized} has no profile document`);
        return;
      }
      setTarget({ ...profile, uid });
    } catch (err: unknown) {
      logger.warn("admin_user_lookup_failed", { username: normalized, error: parseFirebaseError(err) });
      setTarget(null);
      setError("Lookup failed. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const lookup = useCallback(async () => {
    await load(query);
  }, [load, query]);

  const refresh = useCallback(async () => {
    if (!target) return;
    await load(target.username);
  }, [load, target]);

  return { query, setQuery, target, loading, error, lookup, refresh };
}
