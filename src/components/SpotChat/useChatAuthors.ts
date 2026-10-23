import { useEffect, useState } from "react";
import { getUserProfile } from "../../services/users";

/**
 * uid → handle for chat authors. Messages store only the author's uid, so the
 * handle is read from the public profile doc once per uid and cached for the
 * session. A missing or unreadable profile maps to "" (shown as "skater"),
 * never to any part of the uid.
 */
const cache = new Map<string, Promise<string>>();

/** @internal Reset the session cache (tests only). */
export function _resetChatAuthorCache(): void {
  cache.clear();
}

function lookup(uid: string): Promise<string> {
  let hit = cache.get(uid);
  if (!hit) {
    hit = getUserProfile(uid).then(
      (p) => (typeof p?.username === "string" ? p.username : ""),
      () => "",
    );
    cache.set(uid, hit);
  }
  return hit;
}

export function useChatAuthors(uids: readonly string[]): ReadonlyMap<string, string> {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const key = [...new Set(uids)].sort().join("|");

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const list = key.split("|");
    void Promise.all(list.map(async (uid) => [uid, await lookup(uid)] as const)).then((pairs) => {
      if (!cancelled) setNames(new Map(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return names;
}
