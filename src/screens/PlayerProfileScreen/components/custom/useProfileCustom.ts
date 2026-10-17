import { useEffect, useState } from "react";
import {
  DEFAULT_PROFILE_CUSTOM,
  fetchPinnedClips,
  getProfileCustom,
  type PinnableClip,
  type ProfileCustom,
} from "../../../../services/profileCustom";

/** Loads a player's customization + pinned clips. `enabled` false skips all reads. */
export function useProfileCustom(uid: string, enabled: boolean) {
  const [custom, setCustom] = useState<ProfileCustom>(DEFAULT_PROFILE_CUSTOM);
  const [pinned, setPinned] = useState<PinnableClip[]>([]);

  useEffect(() => {
    if (!enabled || !uid) return;
    let alive = true;
    void (async () => {
      const c = (await getProfileCustom(uid)) ?? DEFAULT_PROFILE_CUSTOM;
      if (!alive) return;
      setCustom(c);
      const clips = c.pinnedClipIds.length ? await fetchPinnedClips(uid, c.pinnedClipIds) : [];
      if (alive) setPinned(clips);
    })();
    return () => {
      alive = false;
    };
  }, [uid, enabled]);

  const applySaved = async (next: ProfileCustom) => {
    setCustom(next);
    setPinned(next.pinnedClipIds.length ? await fetchPinnedClips(uid, next.pinnedClipIds) : []);
  };

  return { custom, pinned, applySaved };
}
