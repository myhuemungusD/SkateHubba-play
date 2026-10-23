import { useEffect, useRef, useState } from "react";
import { getBlockedUserIds } from "../../services/blocking";
import { logger } from "../../services/logger";
import { searchPlayersByPrefix } from "../../services/playerSearch";
import type { UserProfile } from "../../services/users";

/** Wait this long after the last keystroke before hitting Firestore. */
export const SKATER_SEARCH_DEBOUNCE_MS = 250;

interface Result {
  query: string;
  players: UserProfile[];
}

/**
 * Handle-prefix search across every skater (see searchPlayersByPrefix), so
 * accounts older than the directory's newest 100 still turn up. Debounced,
 * and it never returns the viewer or anyone they've blocked. `loading` stays
 * true until results for the current query have arrived.
 */
export function usePrefixSkaterSearch(query: string, viewerUid: string): { players: UserProfile[]; loading: boolean } {
  const [result, setResult] = useState<Result>({ query: "", players: [] });
  const blocked = useRef<{ uid: string; ids: Promise<Set<string>> } | null>(null);

  useEffect(() => {
    if (!query) return;
    let stale = false;
    const timer = setTimeout(() => {
      if (blocked.current?.uid !== viewerUid) {
        blocked.current = { uid: viewerUid, ids: getBlockedUserIds(viewerUid).catch(() => new Set<string>()) };
      }
      blocked.current.ids
        .then((ids) => searchPlayersByPrefix(query, new Set([viewerUid, ...ids])))
        .then((players) => {
          if (!stale) setResult({ query, players });
        })
        .catch((err) => {
          logger.warn("skater_prefix_search_failed", { error: err instanceof Error ? err.message : String(err) });
          if (!stale) setResult({ query, players: [] });
        });
    }, SKATER_SEARCH_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query, viewerUid]);

  const current = result.query === query;
  return { players: current ? result.players : [], loading: !!query && !current };
}
